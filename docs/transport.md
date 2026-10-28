# How you travelled

Trail works out from your points where you stopped and how you got from one
place to the next: on foot, by bike, by car, bus, tram, metro, train, boat or
plane. It does this on its own, a few seconds after your phone's points
arrive, and you can always put it right.

## Four ways to look at a track

The map's Live and History views have a switch with four levels (under Map
options on a phone):

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
  A stop is a dot where you were; when you moved around within it without
  walking anywhere — along the platform, about the house — those points are
  drawn as a dotted line. Where your phone recorded nothing for a while and
  you were somewhere else afterwards — or it woke up a little farther on,
  already riding — a thin dashed line joins the two places, so you never
  vanish from the map. The legend explains both when they are on the map.

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
  being in a vehicle apart. Overland and OwnTracks on iPhones (with extended
  data) send it, and Traccar Client 9; the other apps do not, so for them
  Trail decides on speed, the ways and the pauses
  ([trackers.md](trackers.md#which-app)).
- **Overland's trip button**: when you started a trip with a mode, that mode
  counts heavily.
- **Altitude**, for flights.

Each mode gets a score from clear rules; the highest wins, and how far ahead
it is gives the confidence. Below 60 % the move is marked as unsure; below
40 % it is "Unknown". A journey that changes from walking to a vehicle and
back (walk to the station, take the train, walk to the office) is cut into
its parts; a pause of three minutes or more is a stop.

## Stops

A stop is a place you stayed: three minutes or more in one spot, or a visit
your iPhone reported. A stop ends when you leave. Your iPhone reports a visit
when you arrive and again when you leave; Trail puts the two together, and
when the second report never comes, the stop still ends as you set off — it
never swallows the journey after it. A short step outside (to the car and
back) stays part of the stop, and so does a moment your phone placed you a
few hundred metres off, as it does indoors now and then; going out for lunch
makes the morning and the afternoon two stops, with the walk between them.
Until your iPhone reports that you left, though, a visit next door can count
as part of the stop at home.

A real walk between two places you waited at — from the bike shed to the
platform: half a minute or more at walking pace — is a move of its own, so
the Timeline reads stop, walk, stop, however close together they are —
unless your iPhone reported one visit for both places: then the walk stays
inside that stop, drawn as its dotted line. Shuffling along the platform, or
a step or two, is no walk: it stays part of the stop, and the map draws it
as the stop's dotted line. When your phone
recorded nothing for half an hour or more but was back where it had been,
Trail counts that time as a stop, so the day has no hole. When it was
somewhere else afterwards, the Timeline shows a quiet "No data" row with how
long the phone was silent. A stop's details say how long you stayed and,
when you moved around within it, how far.

Without map data — when it is switched off on your server, or not fetched yet
for an area — Trail decides on speed, motion and pauses alone and is less
sure, especially between a car and a train.

## Putting it right

- **A move that was wrong**: click it on the map, or press Details next to it
  in the Timeline under the map. The dialog shows the mode, how sure Trail
  was, the speeds, distance and time. Pick the right mode under Change mode;
  the move shows "set by you" from then on. Reset to detected hands it back to
  Trail. For a move marked as unsure, "Yes" confirms Trail's guess.
- **From now on**: your own card, **Me**, on the People page has a row
  *Now: Walk · Bike · Car · Bus · Train · Tram · Metro · Other · Auto*. Tap
  the mode you are switching to — getting on a train, say — and it holds
  until you stop for 10 minutes or more, or — after a stop — Trail sees you
  travel another way (on foot, by bike, in a vehicle): changing trains does
  not end it, cycling home from the station does. The ride you set it for is
  yours all the way, whatever Trail reads in it: a stretch read as a car
  stays your bike ride, and the walk to the platform takes your train.
  Auto hands it back to Trail; Other has every mode.
  It sets the phone that reported last, which the row names; a second
  device (a tracker in the car, say) is not changed, and its own page under
  **Devices** has the same row, for it.

What you set always wins: Trail keeps it when it works your history out
again, and the statistics count it.

## Insights

The **Insights** tab adds it all up: how far you went, how long you were on
the move, how many moves and stops, and on how many days — for the last 7,
30 or 90 days, this year, all your history or days you choose, and for all
your devices or some. Each number says how it compares with as many days
before. Below them: your distance by mode, the distance (or time) per day,
week or month stacked by mode, and a table of modes. A mode opens its own
page: its speeds, your longest and fastest moves (each with **Show on the
map**, which opens that day with the move's details), when you use it by hour
and weekday, the kinds of road it took you on — or for trains, trams and
metros how much was on the rails and how often they halted at a station —
and its moves by speed. **When you travel** shows the hours of the week you
spend on the move, **Roads** the kinds of road and railway you travelled on.

Every chart can be read with the keyboard — Tab to it, then the arrow keys —
and has its numbers as a table under **Show the numbers**. A move counts in
each day and hour with the part of it that falls there, in your time zone.
The kinds of road come from the map data: moves without it (switched off, or
not fetched yet) count towards the distance only, and the pages say how much
of it the map covers. While new points are still being worked out, a note
says the numbers may still change.

## Privacy

The map data comes from OpenStreetMap through an Overpass server — by default
the public one at overpass-api.de. To fetch it, your Trail server asks for the
map of each square of about 1.5 km your devices passed through (not along
flights), shortly after their points arrive. So that Overpass server learns
which squares were asked for and when, and the internet address of your Trail
server — not your tracks, and not who you are: Trail sends no account, device
or name, and introduces itself as the Trail software, not as your server. A
square it already has is not asked for again for three months.

Your server's owner can switch this off by setting `PROCESSING_OVERPASS_URL=`
(empty): Trail then still works out stops, moves and modes, without map data,
and the Mapped level shows the averaged one. They can also point Trail at an
Overpass server of their own; serving the map data from a local copy of
OpenStreetMap is a possible later step ([operations.md](operations.md#processing)).
