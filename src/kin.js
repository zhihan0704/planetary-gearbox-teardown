export const PARTS = Object.freeze(['input', 'planets', 'ring', 'output']);
export const TEETH = Object.freeze({ sun: 18, planet: 18, ring: 54 });
export const RATIO = 1 + TEETH.ring / TEETH.sun;
export const MODULE_MM = 2;
export const INPUT_RPM = 120;

// Display one quarter of a second of shaft motion per second on screen.
export const DISPLAY_SPEED = 0.25;
export const DRIVE_RATE = INPUT_RPM / 60 * 2 * Math.PI * DISPLAY_SPEED;

// Angles use the stationary housing as their reference frame.
export function driveAtAngle(sun, rpm = INPUT_RPM) {
  const carrier = sun / RATIO;
  const planet = carrier - (sun - carrier) * TEETH.sun / TEETH.planet;
  return { sun, carrier, planet, rpm, outputRpm: rpm / RATIO };
}

export function sampleDrive(t) {
  return driveAtAngle(t * DRIVE_RATE);
}
