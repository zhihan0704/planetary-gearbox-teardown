export const parts = {
  assembly: {
    label: 'Assembled',
    title: 'How it turns',
    description: 'The sun drives three planet gears. The fixed ring forces the planets to walk around it, carrying the output with them.',
    camera: [0.86, 0.39, 1.00, 0],
  },
  input: {
    number: '01', label: 'Input & sun', role: 'DRIVES THE STAGE',
    title: 'The sun gear',
    description: 'The input shaft and 18-tooth sun spin together. Each turn drives all three planets at once.',
    camera: [0.76, 0.40, 1.08, 0.97],
  },
  planets: {
    number: '02', label: 'Planet gears', role: 'SPIN AND ORBIT',
    title: 'Three planet gears',
    description: 'Each 18-tooth planet spins on its own pin while its center orbits with the carrier.',
    camera: [0.52, 0.38, 1.01, 0.72],
  },
  ring: {
    number: '03', label: 'Ring housing', role: 'STAYS FIXED',
    title: 'The fixed ring',
    description: 'The 54 inward-facing teeth stay fixed to the housing. The planets roll along them and pull the carrier around.',
    camera: [0.78, 0.45, 0.93, 1.03],
  },
  output: {
    number: '04', label: 'Output carrier', role: 'TURNS AT ¼ SPEED',
    title: 'The output carrier',
    description: 'The carrier holds all three planet pins. It turns once for every four input turns, in the same direction.',
    camera: [2.25, 0.41, 1.08, -0.72],
  },
  exploded: {
    label: 'Exploded',
    title: 'One stage, four parts',
    description: 'The parts follow a common shaft axis. Reassemble the stack to see the sun, planets and ring mesh in one plane.',
    camera: [1.17, 0.33, 0.81, 1.05],
  },
};

export const partIds = ['input', 'planets', 'ring', 'output'];
