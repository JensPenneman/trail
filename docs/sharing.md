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
     walking, cycling or driving.
   - **For how long**: one hour, until the end of the day (midnight in your
     time zone), a week, or until you stop it.
4. Choose **Share**.

If the address has no account yet, the share waits: they see you as soon as
they sign up with that address. Administrators can send an invitation right
from the dialog. Trail sends no e-mails itself.

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
**Apple Maps**, **Google Maps** and **Share back**. **Hide** removes someone
from your People page without asking them to stop; they still share, are told
that you hid them, and you can show them again under *Hidden*.

Approximate and area positions are the centre of a fixed cell around the
person: the same spot every time, never their exact position.

## Public links

In **Settings › Sharing**, **Make a public link**: a label for the page (your
first name by default), the devices, precision, optionally your route of up to
seven days (precise only), battery and activity (off by default), and when the
link stops working (one hour to 30 days). Copy the address or let someone scan
its code: it is shown only once. Anyone with the address sees the page, which
refreshes every 15 seconds and says when it expires. The list shows how often
each link was opened; **Turn off** ends a link at once.

## For developers

The API reference at `/docs` describes the people, shares and share-links
operations; [api.md](api.md) has a summary, and
[architecture.md §8.4](architecture.md#84-sharing-people) the rules behind
them. What a recipient and a link holder can and cannot see is in
[SECURITY.md](../SECURITY.md).
