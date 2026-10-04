# Marigold Park

A little theme park with a lot going on. Set ticket prices, keep the snack stands stocked, or take a seat on the coaster and watch the day unfold.

https://github.com/user-attachments/assets/661daf8d-57f9-4461-bb86-31e5ad790ba9

[Watch the full walkthrough on X](https://x.com/noclipepe/status/2106855215303397845) · [Screenshot](docs/park.jpg)

## Take a look around

Guests arrive in groups, pick rides, queue for snacks, and eventually head home. Staff run the attractions, clean the paths, and bring fresh stock from the depot.

Click almost anything to see what it is doing. Follow a guest through the park, change the price of popcorn, send a mechanic to a ride, or ride along on the coaster, Ferris wheel, and carousel. Switch to evening when you want the lights on.

## Run it locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the local address printed in the terminal. No API keys, accounts, or asset downloads are needed to run the park after installing the dependencies. The simulation runs in your browser; reloading starts a fresh day.

## Controls

| Action | Control |
| --- | --- |
| Move around | WASD or arrow keys; hold Shift to move faster |
| Orbit / pan | Left-drag / right-drag |
| Zoom | Mouse wheel |
| Inspect / focus | Click / double-click an object |
| Park overview | Home |
| Pause / resume | Space |
| Leave a ride | Esc |
| Portrait layout | P or the Portrait button |

The search box finds guests, staff, rides, and orders by name or ID. Selecting a moving vehicle keeps the camera with it until you move away.

## Record in portrait

The Portrait button switches to a 9:16 layout: park above, selected object's controls below. You can also open the app with `#portrait` in the URL. Desktop is the default.

## Build and checks

```sh
npm test
npm run build
npm run preview
```

The build is written to `dist/`. The checks cover guest journeys, purchases, restocking, maintenance, ride closures, pricing, and simulation consistency.

The scene uses [Three.js](https://threejs.org/), with [Vite](https://vite.dev/) for development and builds. Park geometry and textures are made in code. Simulation, rendering, and interface code live in `src/sim`, `src/render`, and `src/ui`.

Made by [noclipepe](https://x.com/noclipepe).
