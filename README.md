# Commander table

A phone in the middle of a Commander pod. Four quadrants, one per seat. South reads upright, north is rotated 180°, and east and west face the side edges.

Each seat has life (start at 40), poison, and the commander damage that seat's commander has dealt to the other three. The rows under "Dealt to" are that damage. "From" lists damage coming in. A seat is marked at 0 life, 10 poison, or 21 commander damage from one opponent. Damage from two commanders is not added together. Hold a button to keep counting. Undo steps back one change. Reset asks for a second tap. After the first tap, the screen stays awake while the page is open.

The table is saved in this browser. Photo recognition and the ruling slip are not in this build.

```bash
npm install
npm test
npm run dev
```

`npm run dev` listens on the LAN. Open the Network URL on the phone and lay it in the center of the table.
