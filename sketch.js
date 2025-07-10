let cars = [];
let isPaused = false;
let laneSlider, carSlider, speedSlider;
let pauseBtn, resetBtn;

// track geometry
const TRACK_WIDTH_PCT = 0.7;
const TRACK_HEIGHT_PCT = 0.5;
const LANE_SPACING = 30;

// behavior parameters
const SAFE_ANGLE = 0.4; // radians: if gap < this, slow down
const SLOWDOWN_FACT = 0.3; // slow to 30% of baseSpeed when stuck
const LANE_CHANGE_COOLDOWN = 2; // seconds

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSL, 360, 100, 100);
  textFont("Arial");

  // UI
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
}

function initCars() {
  cars = [];
  const lanes = laneSlider.value();
  const count = carSlider.value();
  for (let i = 0; i < count; i++) {
    cars.push(
      new Car(
        random(TWO_PI), // start angle
        random(0.5, 1.0), // baseSpeed (rad/sec)
        color(random(360), 80, 60),
        floor(random(lanes)) // lane index
      )
    );
  }
}

function draw() {
  background(120, 50, 30); // grass

  // track dims
  const cx = width / 2,
    cy = height / 2;
  const cRX = (width * TRACK_WIDTH_PCT) / 2;
  const cRY = (height * TRACK_HEIGHT_PCT) / 2;
  const halfW = (laneSlider.value() * LANE_SPACING) / 2;
  const oRX = cRX + halfW,
    oRY = cRY + halfW;
  const iRX = max(cRX - halfW, 0),
    iRY = max(cRY - halfW, 0);

  // draw road ring
  noStroke();
  fill(0, 0, 20);
  ellipse(cx, cy, oRX * 2, oRY * 2);
  fill(120, 50, 30);
  ellipse(cx, cy, iRX * 2, iRY * 2);

  // lane dividers
  stroke(0, 0, 100);
  strokeWeight(2);
  drawingContext.setLineDash([20, 20]);
  for (let j = 1; j < laneSlider.value(); j++) {
    let offs = -halfW + j * LANE_SPACING;
    ellipse(cx, cy, (cRX + offs) * 2, (cRY + offs) * 2);
  }
  drawingContext.setLineDash([]);

  // boundaries
  stroke(0, 0, 100);
  strokeWeight(4);
  noFill();
  ellipse(cx, cy, oRX * 2, oRY * 2);
  ellipse(cx, cy, iRX * 2, iRY * 2);

  // apply behavior & update
  const dt = deltaTime / 1000;
  if (!isPaused) {
    applyTrafficRules(dt);
    cars.forEach((c) => c.update(dt));
  }

  // draw cars
  cars.forEach((c) => c.show(cx, cy, cRX, cRY));
}

function applyTrafficRules(dt) {
  const lanes = laneSlider.value();

  // group by lane for gap detection
  for (let lane = 0; lane < lanes; lane++) {
    let group = cars
      .filter((c) => c.lane === lane)
      .sort((a, b) => a.angle - b.angle);
    if (group.length === 0) continue;

    for (let i = 0; i < group.length; i++) {
      let car = group[i];
      let next = group[(i + 1) % group.length];
      let gap = (next.angle - car.angle + TWO_PI) % TWO_PI;

      // determine target speed
      let target = car.baseSpeed;
      if (gap < SAFE_ANGLE) {
        target = car.baseSpeed * SLOWDOWN_FACT;
      }

      // smooth speed change
      car.speed += (target - car.speed) * 0.1;

      // attempt lane change if stuck & off cooldown
      if (gap < SAFE_ANGLE && car.canChangeLane()) {
        if (tryLaneChange(car, lane, SAFE_ANGLE * 1.5)) {
          car.markLaneChange();
        }
      }
    }
  }
}

// try to move `car` from `myLane` to an adjacent lane if safe
function tryLaneChange(car, myLane, safeGap) {
  const total = laneSlider.value();
  for (let dir of [-1, 1]) {
    let tgt = myLane + dir;
    if (tgt < 0 || tgt >= total) continue;
    let others = cars
      .filter((c) => c.lane === tgt)
      .sort((a, b) => a.angle - b.angle);
    if (!others.length) {
      car.lane = tgt;
      return true;
    }
    // find ahead & behind in target lane
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
    if (da > safeGap && db > safeGap) {
      car.lane = tgt;
      return true;
    }
  }
  return false;
}

class Car {
  constructor(angle, baseSpeed, col, lane) {
    this.angle = angle;
    this.baseSpeed = baseSpeed;
    this.speed = baseSpeed;
    this.col = col;
    this.lane = lane;
    this._lastLC = -Infinity; // last lane change time (s)
  }
  update(dt) {
    const factor = speedSlider.value() / 10;
    this.angle = (this.angle + this.speed * dt * factor) % TWO_PI;
  }
  show(cx, cy, cRX, cRY) {
    const halfW = (laneSlider.value() * LANE_SPACING) / 2;
    const offs = -halfW + this.lane * LANE_SPACING + LANE_SPACING / 2;
    let rX = cRX + offs,
      rY = cRY + offs;
    let x = cx + rX * cos(this.angle);
    let y = cy + rY * sin(this.angle);

    push();
    translate(x, y);
    rotate(this.angle + HALF_PI);
    noStroke();
    fill(this.col);
    ellipse(0, 0, LANE_SPACING * 0.8, LANE_SPACING * 0.4);
    pop();
  }
  canChangeLane() {
    return millis() / 1000 - this._lastLC > LANE_CHANGE_COOLDOWN;
  }
  markLaneChange() {
    this._lastLC = millis() / 1000;
  }
}
