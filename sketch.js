let asphaltTexture, trackGraphic;
let cars = [];
let isPaused = false;
let laneSlider, carSlider, speedSlider;
let pauseBtn, resetBtn;

const TRACK_WIDTH_PCT = 0.7;
const TRACK_HEIGHT_PCT = 0.5;
const LANE_SPACING = 30;

// behavior constants
const SAFE_ANGLE = 0.4; // radians: if gap < SAFE_ANGLE, slow
const SLOWDOWN_FACT = 0.3; // slow to 30% of baseSpeed
const LANE_CHANGE_COOLDOWN = 2; // seconds between allowed changes
const MIN_GAP = 0.2; // radians: hard minimum gap to prevent overlap

function preload() {
  asphaltTexture = loadImage("assets/asphalt.png");
}

function setup() {
  setAttributes("antialias", true);
  createCanvas(windowWidth, windowHeight);
  colorMode(HSL, 360, 100, 100);
  textFont("Arial");

  buildTrackGraphic();

  // UI panel
  const ctrl = createDiv().id("controls");
  createP("Lanes").parent(ctrl);
  laneSlider = createSlider(1, 5, 3, 1).parent(ctrl);
  createP("Cars").parent(ctrl);
  carSlider = createSlider(5, 100, 30, 1).parent(ctrl);
  createP("Global Speed ×").parent(ctrl);
  speedSlider = createSlider(1, 20, 10, 1).parent(ctrl);

  pauseBtn = createButton("Pause")
    .parent(ctrl)
    .mousePressed(() => {
      isPaused = !isPaused;
      pauseBtn.html(isPaused ? "Resume" : "Pause");
    });

  resetBtn = createButton("Reset").parent(ctrl).mousePressed(initCars);

  initCars();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildTrackGraphic();
}

// tile the asphalt into an offscreen buffer
function buildTrackGraphic() {
  trackGraphic = createGraphics(width, height);
  trackGraphic.noSmooth();
  for (let x = 0; x < width; x += asphaltTexture.width) {
    for (let y = 0; y < height; y += asphaltTexture.height) {
      trackGraphic.image(asphaltTexture, x, y);
    }
  }
}

function initCars() {
  cars = [];
  let lanes = laneSlider.value();
  let count = carSlider.value();
  // compute initial lateral offsets
  let halfW = (lanes * LANE_SPACING) / 2;
  for (let i = 0; i < count; i++) {
    let lane = floor(random(lanes));
    let offset = -halfW + (lane + 0.5) * LANE_SPACING;
    let c = new Car(
      random(TWO_PI), // start angle
      random(0.5, 1.0), // baseSpeed (rad/s)
      color(random(360), 80, 60),
      lane,
      offset
    );
    // stagger initial lane-change availability
    c._lastLC = millis() / 1000 - random(0, LANE_CHANGE_COOLDOWN);
    cars.push(c);
  }
}

function draw() {
  background(120, 50, 30); // grass

  // center & radii
  const cx = width / 2,
    cy = height / 2;
  const cRX = (width * TRACK_WIDTH_PCT) / 2;
  const cRY = (height * TRACK_HEIGHT_PCT) / 2;
  const halfW = (laneSlider.value() * LANE_SPACING) / 2;
  const outerRX = cRX + halfW,
    outerRY = cRY + halfW;
  const innerRX = max(cRX - halfW, 0),
    innerRY = max(cRY - halfW, 0);

  // draw textured road ring
  drawTexturedRing(cx, cy, outerRX, outerRY, innerRX, innerRY);

  // dashed lane dividers
  stroke(0, 0, 100);
  strokeWeight(2);
  drawingContext.setLineDash([20, 20]);
  for (let j = 1; j < laneSlider.value(); j++) {
    let offs = -halfW + j * LANE_SPACING;
    ellipse(cx, cy, (cRX + offs) * 2, (cRY + offs) * 2);
  }
  drawingContext.setLineDash([]);

  // solid boundaries
  stroke(0, 0, 100);
  strokeWeight(4);
  noFill();
  ellipse(cx, cy, outerRX * 2, outerRY * 2);
  ellipse(cx, cy, innerRX * 2, innerRY * 2);

  // update & draw cars
  const dt = deltaTime / 1000;
  if (!isPaused) {
    applyTrafficRules();
    cars.forEach((c) => c.update(dt, cars));
  }
  cars.forEach((c) => c.show(cx, cy, cRX, cRY));
}

// clip everything except the ring, then stamp the asphalt texture
function drawTexturedRing(cx, cy, oRX, oRY, iRX, iRY) {
  push();
  let ctx = drawingContext;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, oRX, oRY, 0, 0, TWO_PI);
  ctx.ellipse(cx, cy, iRX, iRY, 0, 0, TWO_PI, true);
  ctx.clip("evenodd");
  image(trackGraphic, 0, 0);
  ctx.restore();
  pop();
}

// slowdown + lane-change requests
function applyTrafficRules() {
  let lanes = laneSlider.value();

  for (let lane = 0; lane < lanes; lane++) {
    // cars in this lane sorted by angle
    let group = cars
      .filter((c) => c.lane === lane)
      .sort((a, b) => a.angle - b.angle);
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      let car = group[i];
      let next = group[(i + 1) % group.length];
      let gap = (next.angle - car.angle + TWO_PI) % TWO_PI;

      // target speed
      let factor = gap < SAFE_ANGLE ? SLOWDOWN_FACT : 1;
      let target = car.baseSpeed * factor;
      car.speed += (target - car.speed) * 0.1;

      // only request if enough time has passed
      if (gap < SAFE_ANGLE && car.canChangeLane()) {
        let newLane = tryLaneChange(car, lane, SAFE_ANGLE * 1.5);
        if (newLane !== null) car.requestLaneChange(newLane);
      }
    }
  }
}

// find a safe adjacent lane or return null
function tryLaneChange(car, myLane, safeGap) {
  let total = laneSlider.value();
  for (let dir of [-1, 1]) {
    let tgt = myLane + dir;
    if (tgt < 0 || tgt >= total) continue;
    let others = cars
      .filter((c) => c.lane === tgt)
      .sort((a, b) => a.angle - b.angle);
    if (others.length === 0) return tgt;

    let ahead =
      others.find((o) => (o.angle - car.angle + TWO_PI) % TWO_PI > 0) ||
      others[0];
    let behind =
      [...others]
        .reverse()
        .find((o) => (car.angle - o.angle + TWO_PI) % TWO_PI > 0) ||
      others[others.length - 1];
    let da = (ahead.angle - car.angle + TWO_PI) % TWO_PI;
    let db = (car.angle - behind.angle + TWO_PI) % TWO_PI;
    if (da > safeGap && db > safeGap) return tgt;
  }
  return null;
}

class Car {
  constructor(angle, baseSpeed, col, lane, initialOffset) {
    this.angle = angle;
    this.baseSpeed = baseSpeed;
    this.speed = baseSpeed;
    this.col = col;
    this.lane = lane;
    this.targetLane = lane;
    this.laneOffset = initialOffset;
    this.targetOffset = initialOffset;
    this._lastLC = 0;
  }

  // schedule a lane‐switch animation
  requestLaneChange(newLane) {
    this.targetLane = newLane;
    let halfW = (laneSlider.value() * LANE_SPACING) / 2;
    this.targetOffset = -halfW + (newLane + 0.5) * LANE_SPACING;
    this._lastLC = millis() / 1000;
  }

  canChangeLane() {
    return millis() / 1000 - this._lastLC > LANE_CHANGE_COOLDOWN;
  }

  update(dt, allCars) {
    // forward motion, clamped to avoid overlap
    let factor = speedSlider.value() / 10;
    let rawDist = this.speed * dt * factor;

    // find leader gap in this.lane
    let laneCars = allCars
      .filter((c) => c.lane === this.lane)
      .sort((a, b) => a.angle - b.angle);
    if (laneCars.length > 1) {
      let idx = laneCars.indexOf(this);
      let leader = laneCars[(idx + 1) % laneCars.length];
      let gap = (leader.angle - this.angle + TWO_PI) % TWO_PI;
      let maxDist = max(gap - MIN_GAP, 0);
      rawDist = min(rawDist, maxDist);
    }

    this.angle = (this.angle + rawDist) % TWO_PI;

    // smooth lane slide
    this.laneOffset = lerp(this.laneOffset, this.targetOffset, 0.1);
    // once nearly there, commit
    if (abs(this.laneOffset - this.targetOffset) < 1) {
      this.lane = this.targetLane;
    }
  }

  show(cx, cy, cRX, cRY) {
    // compute position with lateral offset
    let x = cx + (cRX + this.laneOffset) * cos(this.angle);
    let y = cy + (cRY + this.laneOffset) * sin(this.angle);

    push();
    translate(x, y);
    rotate(this.angle + HALF_PI);
    noStroke();
    fill(this.col);
    ellipse(0, 0, LANE_SPACING * 0.8, LANE_SPACING * 0.4);
    pop();
  }
}
