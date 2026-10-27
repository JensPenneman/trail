# Sharing your location

Trail can show where you are to the people you choose, much like Find My on an
iPhone: they see you under **People**, on a map with your battery and what you
are doing, until the time you picked or until you stop. For someone without an
account on your server there are **public links**.

## Share with a person

1. Open **People** and choose **Share my location**.
2. Enter their email address. People who already share with you are offered
   as suggestions.
3. Pick what they see:
   - **Devices**: all your devices (also the ones you add later), or some.
   - **How precisely**: *Precise* — where you are, as your phone records it;
     *Approximate* — within about 500 m, the neighbourhood but not the street;
     *Area* — within about 5 km, the town or part of the city.
   - **Where you have been**: live only (the default), or the last 24 hours,
     7 or 30 days. History is only offered with a precise location: a rough
     position over time would give away more than you chose.
   - **Battery and activity**: your phone's battery, and whether you are
     walking, cycling, driving or on a train — as Trail works it out, or as
     you set it with *Now* in the map's Live view
     ([transport.md](transport.md)).
   - **For how long**: one hour, until the end of the day (midnight in your
     time zone), a week, or until you stop it.
4. Choose **Share**.

If the address has no account yet, the share waits. Trail does not check that
an address belongs to whoever signs up with it, so when someone does,
**You share with** asks "*name* (*address*) joined Trail — confirm?": choose
**Confirm** if it is the person you meant, **Cancel** if not. Until you
confirm they see nothing of you. An invitation to that address skips the
question — an administrator sent it to that person on purpose — and
administrators can send one right from the dialog. Trail sends no e-mails
itself.

Sharing works one way. They see you; you see them only if they share back,
with **Share back** on their card.

## Change or stop

Under **You share with** on People (or in Settings › Sharing) every share shows
what it shares and until when, and when they last looked. **Change** sets a new
duration from now or other devices, precision, history or details; **Stop** ends
the share at once — from that moment they see nothing of you.

## People who share with you

Each person has a card: their devices, when the position was updated, what
they are doing, battery and the distance from you, with **Show on map**,
**Apple Maps**, **Google Maps** and **Share back**. **Show on map** opens the
Map page with them; there, under *People* (in *Map options* on a phone), you
choose whose data the map shows — yourself, any of them or everyone — in
every view. A history they share shows as their track in History; without
one the map shows only where they are now. **Hide** removes someone
from your People page without asking them to stop; they still share, are told
that you hid them, and you can show them again under *Hidden*. Hiding holds
for the person: when they share with you again later, the new share starts
hidden too, without a notice.

Approximate and area positions are the centre of a fixed cell around the
person: the same spot every time, never their exact position. Each person has
one grid for all their devices, shares and links, so putting several of them
together tells no more than one.

## Public links

In **Settings › Sharing**, **Make a public link**: a label for the page
(“Shared location” unless you write one — the page never shows your name),
the devices, precision, optionally your route of up to
seven days (precise only), battery and activity (off by default), and when the
link stops working (one hour to 30 days). Copy the address or let someone scan
its code: it is shown only once. Anyone with the address sees the page, which
refreshes every 15 seconds and says when it expires. The list shows how often
each link was opened; **Turn off** ends a link at once.

The secret is the part of the address after `#`. Browsers keep that part to
themselves: it never reaches your server's or any proxy's logs, and no other
site learns it from a link on the page. The page passes it to Trail in a
request header.

## For developers

The API reference at `/docs` describes the people, shares and share-links
operations; [api.md](api.md) has a summary, and
[architecture.md §8.5](architecture.md#85-sharing-people) the rules behind
them. An API token needs `shares:write` and `locations:read` to start, change
or confirm a share and to make a link: anything that can show positions needs
`locations:read`. What a recipient and a link holder can and cannot see is in
[SECURITY.md](../SECURITY.md).
