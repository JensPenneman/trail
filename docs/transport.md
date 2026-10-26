# How you travelled

Trail works out from your points where you stopped and how you got from one
place to the next: on foot, by bike, by car, bus, tram, metro, train, boat or
plane. It does this on its own, a few seconds after your phone's points
arrive, and you can always put it right.

## Four ways to look at a track

The map on the History and Live pages has a switch with four levels:

- **Raw**: the points exactly as your phone sent them, with their GPS noise.
- **Averaged**: stray points left out (a fix that is kilometres off for a
  moment, a very inaccurate one) and the noise smoothed, so a slow walk is not
  a zigzag and a phone on a table is a dot, not a star.
- **Mapped**: the averaged points laid onto the roads, paths and railways of
  OpenStreetMap, with the shape of the way between them. A train ride your
  phone recorded only every few minutes follows the rails instead of cutting
  straight across the fields. A flight stays as averaged: no road explains
  it.
- **Transport**: your day as stops and moves, each move coloured by how you
  travelled, with a legend. A dashed outline marks a move Trail is unsure of.

Trail remembers your choice on each browser, and the address of the page
keeps it, so a link shows the same view. When part of a track is not worked
out yet — the points just arrived, or the map of that area is still being
fetched — that part is shown at the level it has, and a line under the switch
says so.

## How the mode is worked out

For every move Trail looks at:

- **Speed**: how fast you went most of the time and at the top.
- **The ways you followed**: railways, tram tracks, motorways, streets,
  cycleways or footpaths, and ferry routes. For a train recorded every few
  minutes it checks whether the straight lines between the points stay near a
  railway.
- **Where you paused**: at stations, tram stops, bus stops, ferry terminals;
  a bus pauses at most of the bus stops it passes, a car only at a few.
- **Your phone's motion sensor**: iOS tells walking, running, cycling and
  being in a vehicle apart.
- **Overland's trip button**: when you started a trip with a mode, that mode
  counts heavily.
- **Altitude**, for flights.

Each mode gets a score from clear rules; the highest wins, and how far ahead
it is gives the confidence. Below 60 % the move is marked as unsure; below
40 % it is "Unknown". A journey that changes from walking to a vehicle and
back (walk to the station, take the train, walk to the office) is cut into
its parts; a pause of three minutes or more is a stop.

Without map data — when it is switched off on your server, or not fetched yet
for an area — Trail decides on speed, motion and pauses alone and is less
sure, especially between a car and a train.

## Putting it right

- **A move that was wrong**: click it on the map, or press Details next to it
  in the Timeline under the map. The dialog shows the mode, how sure Trail
  was, the speeds, distance and time. Pick the right mode under Change mode;
  the move shows "set by you" from then on. Reset to detected hands it back to
  Trail. For a move marked as unsure, "Yes" confirms Trail's guess.
- **From now on**: on the Live page every device card has a row
  *Now: Walk · Bike · Car · Bus · Train · Tram · Metro · Other · Auto*. Tap
  the mode you are switching to — getting on a train, say — and it holds
  until your next stop. Auto hands it back to Trail; Other has every mode.

What you set always wins: Trail keeps it when it works your history out
again, and the statistics count it.

## Privacy

The map data comes from OpenStreetMap through an Overpass server — by default
the public one at overpass-api.de. To fetch it, your Trail server asks for the
map of the squares (about 1.5 by 1 km) your devices passed through — not
along flights — so that server learns which areas you visited, though not
when or who. Your server's
owner can point Trail at an Overpass server of their own, or switch map data
off ([operations.md](operations.md#processing)).
