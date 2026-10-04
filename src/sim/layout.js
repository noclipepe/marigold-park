// Static park layout shared by the simulation and the renderer.
// Coordinates: x east, z south (metres). Ground is y = 0.

import { Lane } from './util.js';

export const PARK = { name: 'Marigold Park', minX: -92, maxX: 92, minZ: -66, maxZ: 66 };

const ring = (i) => {
  const a = (i * Math.PI) / 4;
  return [Math.round((12 * Math.cos(a)) * 100) / 100, Math.round((16 + 12 * Math.sin(a)) * 100) / 100];
};

export const NODES = {
  SPAWN: [0, 84], GATE: [0, 63], ENT: [0, 53], BX: [0, 46], B1: [0, 38],
  P0: ring(0), P1: ring(1), P2: ring(2), P3: ring(3), P4: ring(4), P5: ring(5), P6: ring(6), P7: ring(7),
  // West: coaster
  CQE: [-25, 18], W2: [-38, 20], CX: [-51, 18], W3: [-66, 10], CoM: [-19.5, 7.2],
  // Shops
  K1Q: [-12, 34], K1X: [-16.5, 29], K1S: [-27, 34],
  K2Q: [12, 34], K2X: [16.5, 29], K2S: [27, 34],
  // East / north
  E1: [23, 18.5], E7: [40, 25], CaX: [43, 21.6], E8: [57, 17], E3: [54, -2], E2: [22, -2], CaM: [46.6, 11],
  WQE: [41.4, -14.8], WX: [55, -22], WM: [40.2, -34.4], N1: [1, -10], N2: [13, -20],
  // Service
  DEPOT: [66, 43], SR1: [54, 48], SR2: [31, 48], SR3: [10, 48], SR4: [-10, 48], SR5: [-31, 46],
  SR6: [74, 24], SR7: [68, -6], SR8: [62, -28],
};

export const NODE_NAMES = {
  SPAWN: 'Main entrance', GATE: 'Entrance gate', ENT: 'Entrance plaza', BX: 'Service crossing', B1: 'Marigold Boulevard',
  P0: 'Fountain Plaza', P1: 'Fountain Plaza', P2: 'Fountain Plaza', P3: 'Fountain Plaza', P4: 'Fountain Plaza', P5: 'Fountain Plaza', P6: 'Fountain Plaza', P7: 'Fountain Plaza',
  CQE: 'Cyclone queue entrance', W2: 'Cyclone Walk', CX: 'Cyclone exit', W3: 'Lift Hill Lookout', CoM: 'Cyclone control room',
  K1Q: 'Strawberry Stand', K1X: 'Strawberry Stand pickup', K1S: 'Strawberry Stand service door',
  K2Q: 'Pretzel & Pop', K2X: 'Pretzel & Pop pickup', K2S: 'Pretzel & Pop service door',
  E1: 'Carousel Green', E7: 'Carousel Green', CaX: 'Carousel exit', E8: 'East Promenade', E3: 'East Promenade', E2: 'Lakeside Walk', CaM: 'Carousel service door',
  WQE: 'Skyview queue entrance', WX: 'Skyview exit', WM: 'Skyview drive house', N1: 'Lakeside Walk', N2: 'Lakeside Walk',
  DEPOT: 'Service depot', SR1: 'Service road', SR2: 'Service road', SR3: 'Service road', SR4: 'Service road', SR5: 'Service road',
  SR6: 'Service road', SR7: 'Service road', SR8: 'Service road',
};

// [a, b, kind] kind: 'main' | 'path' | 'service' | 'plaza'
export const EDGES = [
  ['SPAWN', 'GATE', 'main'], ['GATE', 'ENT', 'main'], ['ENT', 'BX', 'main'], ['BX', 'B1', 'main'], ['B1', 'P2', 'main'],
  ['P0', 'P1', 'plaza'], ['P1', 'P2', 'plaza'], ['P2', 'P3', 'plaza'], ['P3', 'P4', 'plaza'], ['P4', 'P5', 'plaza'], ['P5', 'P6', 'plaza'], ['P6', 'P7', 'plaza'], ['P7', 'P0', 'plaza'],
  ['P4', 'CQE', 'path'], ['CQE', 'W2', 'path'], ['W2', 'CX', 'path'], ['CX', 'W3', 'path'],
  ['B1', 'K1Q', 'path'], ['K1Q', 'P3', 'path'], ['K1X', 'P3', 'path'], ['K1X', 'CQE', 'path'],
  ['B1', 'K2Q', 'path'], ['K2Q', 'P1', 'path'], ['K2X', 'P1', 'path'], ['K2X', 'E7', 'path'],
  ['P0', 'E1', 'path'], ['E1', 'E7', 'path'], ['E7', 'CaX', 'path'], ['E7', 'E8', 'path'], ['E8', 'E3', 'path'],
  ['P7', 'E2', 'path'], ['E2', 'E3', 'path'], ['E3', 'WX', 'path'], ['E2', 'WQE', 'path'],
  ['P6', 'N1', 'path'], ['N1', 'N2', 'path'], ['N2', 'WQE', 'path'],
  // Service access (staff only; the cart may cross the boulevard at BX).
  ['DEPOT', 'SR1', 'service'], ['SR1', 'SR2', 'service'], ['SR2', 'K2S', 'service'], ['SR2', 'SR3', 'service'], ['SR3', 'BX', 'service'],
  ['BX', 'SR4', 'service'], ['SR4', 'SR5', 'service'], ['SR5', 'K1S', 'service'],
  ['DEPOT', 'SR6', 'service'], ['SR6', 'SR7', 'service'], ['SR7', 'SR8', 'service'], ['SR8', 'WM', 'service'], ['SR6', 'E8', 'service'],
  ['E8', 'CaM', 'service'], ['CQE', 'CoM', 'service'], ['WX', 'WM', 'service'],
];

// Coaster station / queue.
export const COASTER = {
  id: 'R-01', name: 'Cyclone', short: 'Cyclone',
  queue: new Lane([[-37.6, 5.4], [-37.6, 7.1], [-28.4, 7.1], [-28.4, 9.5], [-44.4, 9.5], [-44.4, 11.9], [-28.4, 11.9], [-28.4, 14.2], [-25.6, 15.4], [-25, 18]]),
  queueEntryNode: 'CQE',
  boardGate: [-37.6, 4.2],
  exitLane: new Lane([[-46.6, 3.0], [-48.6, 3.0], [-49.6, 6.5], [-50.6, 12], [-51, 18]]),
  exitNode: 'CX',
  maintNode: 'CoM',
  attendantPos: [-21.4, 3.4],
  price: 8, fairPrice: 8,
  center: [-30, -26],
};

export const WHEEL = {
  id: 'R-02', name: 'Skyview Wheel', short: 'Skyview',
  hub: [42, 17.2, -31], radius: 14, cabins: 12, yaw: -0.55,
  queue: new Lane([[42.83, -28.11], [43.93, -26.32], [38.64, -23.08], [39.79, -21.2], [48.32, -26.43], [49.47, -24.56], [40.94, -19.33], [42.09, -17.45], [41.4, -14.8]]),
  loadPoint: [42.83, -28.11], unloadPoint: [44.29, -29.0],
  exitLane: new Lane([[44.29, -29.0], [48.61, -29.77], [53.85, -28.88], [55, -22]]),
  queueEntryNode: 'WQE',
  exitNode: 'WX',
  maintNode: 'WM',
  attendantPos: [41.6, -27.0],
  price: 5, fairPrice: 6,
  center: [42, -31],
};

export const CAROUSEL = {
  id: 'R-03', name: 'Grand Carousel', short: 'Carousel',
  center: [36, 11], radius: 7.4, mounts: 16,
  queue: new Lane([[27.2, 9.6], [19.6, 9.6], [19.6, 12.0], [25.8, 12.0], [25.8, 14.6], [23.6, 16.2], [23, 18.5]]),
  queueEntryNode: 'E1',
  gate: [28.2, 9.6],
  exitGate: [41.6, 18.4],
  exitLane: new Lane([[41.6, 18.4], [43, 21.6]]),
  exitNode: 'CaX',
  maintNode: 'CaM',
  attendantPos: [27.6, 7.4],
  price: 3, fairPrice: 4,
};

export const SHOPS = [
  {
    id: 'K-01', name: 'Strawberry Stand', center: [-22.6, 34], facing: 1, // counter faces +x
    counter: [-19.0, 34], queue: new Lane([[-18.4, 34], [-12, 34]]), queueNode: 'K1Q', pickupNode: 'K1X', serviceNode: 'K1S',
    workerPos: [-20.9, 34], color: 0xe2495b,
    products: [
      { id: 'icecream', name: 'Strawberry ice cream', price: 5, stock: 26, max: 40, kind: 'food' },
      { id: 'lemonade', name: 'Pink lemonade', price: 4, stock: 30, max: 40, kind: 'drink' },
      { id: 'shake', name: 'Strawberry shake', price: 6, stock: 18, max: 30, kind: 'drink' },
    ],
  },
  {
    id: 'K-02', name: 'Pretzel & Pop', center: [22.6, 34], facing: -1,
    counter: [19.0, 34], queue: new Lane([[18.4, 34], [12, 34]]), queueNode: 'K2Q', pickupNode: 'K2X', serviceNode: 'K2S',
    workerPos: [20.9, 34], color: 0x2f7fd0,
    products: [
      { id: 'pretzel', name: 'Salted pretzel', price: 5, stock: 13, max: 36, kind: 'food' },
      { id: 'popcorn', name: 'Butter popcorn', price: 4, stock: 12, max: 36, kind: 'food' },
      { id: 'cola', name: 'Iced cola', price: 3, stock: 22, max: 40, kind: 'drink' },
    ],
  },
];

export const DEPOT = { pos: [70, 40], dock: [66, 43], cartHome: [64.5, 40.5], name: 'Service Depot' };

// Benches: position, facing yaw, node to reach them from.
export const BENCHES = [
  { id: 'B-01', pos: [6.2, 6.4], yaw: 2.6, node: 'P7' },
  { id: 'B-02', pos: [-6.2, 6.4], yaw: -2.6, node: 'P5' },
  { id: 'B-03', pos: [-16.2, 22.6], yaw: -0.9, node: 'P3' },
  { id: 'B-04', pos: [16.2, 22.6], yaw: 0.9, node: 'P1' },
  { id: 'B-05', pos: [-68.5, 6.0], yaw: Math.PI, node: 'W3' },
  { id: 'B-06', pos: [-63.4, 6.0], yaw: Math.PI, node: 'W3' },
  { id: 'B-07', pos: [10.4, -23.4], yaw: Math.PI * 0.85, node: 'N2' },
  { id: 'B-08', pos: [15.6, -23.4], yaw: -Math.PI * 0.85, node: 'N2' },
  { id: 'B-09', pos: [-5.0, 55.8], yaw: -Math.PI / 2, node: 'ENT' },
  { id: 'B-10', pos: [5.0, 55.8], yaw: Math.PI / 2, node: 'ENT' },
  { id: 'B-11', pos: [56.8, 12.0], yaw: Math.PI / 2, node: 'E8' },
];

// Places where litter collects and the cleaner works.
export const LITTER_SPOTS = [
  { id: 'L-01', name: 'Fountain Plaza (west)', node: 'P4', pos: [-9.5, 13] },
  { id: 'L-02', name: 'Fountain Plaza (east)', node: 'P0', pos: [9.5, 19] },
  { id: 'L-03', name: 'Strawberry Stand pickup', node: 'K1X', pos: [-15, 27.6] },
  { id: 'L-04', name: 'Pretzel & Pop pickup', node: 'K2X', pos: [15, 27.6] },
  { id: 'L-05', name: 'Entrance plaza', node: 'ENT', pos: [2.5, 51] },
  { id: 'L-06', name: 'Lakeside Walk', node: 'N2', pos: [12, -18] },
  { id: 'L-07', name: 'Lift Hill Lookout', node: 'W3', pos: [-64, 11] },
];

export const LAKE = { center: [12, -36], rx: 11, rz: 8 };
