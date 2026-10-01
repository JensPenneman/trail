# Overland: setting up a phone

Trail receives locations from [Overland](https://github.com/aaronpk/Overland-iOS),
a free, open-source GPS logger for iOS (App Store: "Overland GPS Tracker").
Overland records in the background, stores every point on the phone and sends
them in batches; it deletes a batch only after Trail confirms it, so points
recorded without a connection are sent later instead of being lost.

Each phone is a *device* in Trail with its own access token. A person can have
several devices, and every device belongs to one person.

## 1. Add the device in Trail

1. In the dashboard: Devices > Add device, and give it a name ("Jens's
   iPhone").
2. Trail shows a QR code. Scan it with the iPhone's **Camera** app and tap the
   Overland banner: Overland opens and stores the receiver endpoint, the
   access token and the device ID. On the phone itself, use "Open in Overland"
   instead.
3. Keep the page open: it confirms the first upload as soon as it arrives.

The QR code contains the token. It is shown once; Trail keeps only a hash. To
set up the phone again, use Rotate token on the device page, which shows a new
QR code and makes the old token invalid at once.

### Manual setup

If scanning does not work, enter the values from the "manual" section of the
same page in Overland > Settings > Server URL:

| Overland field | Value |
|---|---|
| Receiver Endpoint | `<INGEST_BASE_URL>/api/overland`, e.g. `http://192.168.1.20:8080/api/overland` during the LAN phase, `https://trail.jenspenneman.com/api/overland` once public |
| Access Token | the device token (`trl_…`) |
| Device ID | the device ID shown by Trail |

Overland sends the token as `Authorization: Bearer <token>`. The token decides
which device a point belongs to; the Device ID is stored for reference.

## 2. iOS permissions

- **Location: Always, with Precise Location on.** Request the permission in
  Overland > Settings > Location Authorization Status; after the second
  request it should read "Always". Or set it in Settings > Privacy & Security >
  Location Services > Overland > Always. Without Always, recording stops when
  the app is in the background; without Precise Location, positions are only
  approximate (kilometres off).
- **Local Network** (LAN phase): when iOS asks whether Overland may connect to
  devices on the local network, allow it, otherwise uploads to the laptop's
  LAN address fail. Check it under Settings > Privacy & Security > Local
  Network > Overland.
- **Background App Refresh** on for Overland (Settings > General > Background
  App Refresh).
- **Motion & Fitness** on, for the walking/driving/cycling states.
- **Notifications** on, so Overland can report upload errors.
- Do not swipe Overland away in the app switcher: iOS stops delivering
  continuous location updates to an app you closed.
- **Low Power Mode** switches Background App Refresh off and makes iOS
  suspend background apps sooner. Expect fewer points and later uploads while
  it is on; the queued points arrive afterwards.

## 3. Recommended settings

Trail offers four presets that match these settings. Pick one on the device
page (Remote settings) and Trail sends it to the phone in the reply to its next
upload, so the phone does not have to be at hand. **Balanced** is the
everyday default; **Balanced+** trades a little battery for GPS-quality tracks.

| Overland setting | Balanced | Balanced+ | High resolution | Battery saver |
|---|---|---|---|---|
| Send Interval | 5 min | 5 min | 1 min | 10 min |
| Continuous Tracking Mode | Standard | Both | Standard | Significant Location |
| Visit Tracking | on | on | on | on |
| Desired Accuracy | 100m | 10m | Best | 100m |
| Activity Type | Other | Other | Other | Other |
| Show Background Location Indicator | (unchanged) | Never | Always | (unchanged) |
| Pause Updates Automatically | on | on | off | on |
| Resume with Geofence | 200m | 100m | off | 500m |
| Logging Mode | All Data | All Data | All Data | All Data |
| Locations per Batch | 200 | 500 | 500 | 200 |
| Min Distance Between Points | 10m | 10m | off | off |
| Min Time Between Points | 5s | 1s | 1s | 1s |

Whatever else you change, keep these:

- **Logging Mode: All Data.** "Only Latest" and "Owntracks" send a different
  format; Trail answers with an error that tells you to switch.
- **Consider HTTP 2XX Successful** (in the iOS Settings app under Overland):
  off. Trail confirms each batch with `{"result":"ok"}`, and anything else
  keeps the batch on the phone for another try.
- Send Interval must not be "off", or the phone stops uploading.

"Include tracking stats" and "Include Unique ID in Logs" (also in the iOS
Settings app) are optional: Trail stores the extra fields and the app
lifecycle events they add.

## 4. Check that data arrives

On the phone, Overland's Tracker screen shows:

- **Queued**: points waiting on the phone. It drops to (near) zero after each
  successful upload.
- **Last Sent**: time since the last accepted upload.
- **Send Now**: uploads immediately, handy while testing.

In Trail, the **Live** page shows every device's last upload ("2 min ago"),
battery and position, plus a feed of uploads as they arrive; the device page
lists every upload in its ingest log with the number of points. The two should
agree: when Last Sent changes on the phone, a new entry appears in Trail.

To test the endpoint and token without the phone, from the laptop:

```powershell
curl.exe -H "Authorization: Bearer trl_..." http://localhost:8080/api/overland
# {"name":"Jens's iPhone"}
```

## FAQ

**Why is there a blue location indicator in the status bar, and can it go?**
iOS shows it when an app uses location in the background and either the app
asks for it (Overland's *Show Background Location Indicator*) or the app only
has *While Using* permission. Give Overland **Always** (Settings > Overland >
Location) and turn the indicator off in Overland, or apply the Balanced+ preset,
which does both settings in one go except the permission. Tracking keeps
working: with *Always* and Continuous Tracking Mode *Both*, iOS wakes Overland
on significant location changes even if it suspended the app. The indicator
only improves the odds of an uninterrupted high-frequency session, which is why
High resolution keeps it on.


**The phone was away from home during the LAN phase. Is that data lost?**
No. Overland keeps recording and queues the points; they are uploaded once the
phone reaches the endpoint again (back on the home Wi-Fi, or after the switch
to the public address).

**Overland shows "Invalid access token".**
The token was rotated or the device deleted. Scan the device's current QR code
(Rotate token shows one). The queued points are kept and sent afterwards.

**Overland shows "Expected Overland JSON with a "locations" array".**
Logging Mode is not All Data. Switch it; the queue is sent in the right format
from then on.

**Overland shows "Server temporarily unavailable".**
Trail's database is not reachable. Nothing is lost: the phone keeps the batch
and retries at the next interval.

**Uploads fail right after going public.**
The phone still has the LAN endpoint, or Cloudflare challenges the upload. See
"After the address changes" and the tunnel steps in
[operations.md](operations.md).

**Does Trail keep duplicate points when a batch is sent twice?**
No. A point is identified by device and timestamp, so a re-sent batch is
stored once.

**What happens to a single invalid point?**
Trail stores it in a reject log with the reason and still accepts the batch,
so one bad record cannot block the phone's queue.

**How much battery does it use?**
It depends mostly on Desired Accuracy and whether updates pause: High
resolution can take a noticeable share of a day's battery, Battery saver
hardly any. Balanced sits in between; try it for a few days and adjust.

**Can several phones share a device?**
No. Give every phone its own device, so each has its own token, status and
history.
