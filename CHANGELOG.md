# Changelog

## [0.5.0](https://github.com/JensPenneman/trail/compare/v0.4.0...v0.5.0) (2026-10-28)


### Features

* a heatmap that reads at every zoom — squares, a key of counts and 24 m cells ([#51](https://github.com/JensPenneman/trail/issues/51)) ([c36c621](https://github.com/JensPenneman/trail/commit/c36c6214993de79258b37d1fb8dbbaa69524c325))
* **api:** a stop's place in the tracks, its spread in the timeline ([e636c56](https://github.com/JensPenneman/trail/commit/e636c56a9f14cfd1781e93d103abf9a3c835a902))
* **api:** heat cells at every level from 6 to 18 ([0583ad0](https://github.com/JensPenneman/trail/commit/0583ad0aacce58c39575e432cf68dc523d322dfc))
* **api:** heat level 20, so the streets get cells of their size ([f3213a1](https://github.com/JensPenneman/trail/commit/f3213a1708049009f3cca00da82b5532443f2eaa))
* **contracts:** a track segment's spread, a toggle's ending stop ([08ec5be](https://github.com/JensPenneman/trail/commit/08ec5be96badfb42173953c8c00390923277f794))
* people as people on People, the proof of uploads on Devices ([#52](https://github.com/JensPenneman/trail/issues/52)) ([269dbda](https://github.com/JensPenneman/trail/commit/269dbda0793206f1b93a3590cd2ccfe7dab7daff))
* phones with OwnTracks, Traccar Client, OsmAnd and GPSLogger ([1b28035](https://github.com/JensPenneman/trail/commit/1b280358dbe3fb0cb5fbecfe460857c68ab863e7))
* phones with OwnTracks, Traccar Client, OsmAnd and GPSLogger ([#54](https://github.com/JensPenneman/trail/issues/54)) ([f472109](https://github.com/JensPenneman/trail/commit/f472109b912c0328e682a4eb4661c4eb276b9724))
* **web:** nobody vanishes from the Transport map or the timeline ([3b15981](https://github.com/JensPenneman/trail/commit/3b159817d2fc3ebabddd29d9c4b759227bc732f6))
* **web:** people as people on People, the proof of uploads on Devices ([f5d7c72](https://github.com/JensPenneman/trail/commit/f5d7c72b53e6f163e871e6cacc3b146dcaa996ca))
* **web:** the heatmap as squares with a key of counts ([1b972ba](https://github.com/JensPenneman/trail/commit/1b972bad9abee9071147e0454c974bb4c2d54bab))


### Bug Fixes

* **api:** a preview without a token keeps its escapes ([000a10a](https://github.com/JensPenneman/trail/commit/000a10af7d7b3446d0fca813eec12f9783483a57))
* **api:** a settings preset only while the device is set up for Overland ([7219a1d](https://github.com/JensPenneman/trail/commit/7219a1df705783d94ac1075a6daddf3273693a48))
* **api:** a text without a token reaches the normalisers as it arrived ([76a24fa](https://github.com/JensPenneman/trail/commit/76a24fab9c0f3bf590b45bc7931395385b0f6af8))
* **api:** check every device's heat levels at each start ([2caead1](https://github.com/JensPenneman/trail/commit/2caead1f2f6e0965429fcc1a9059cde291054702))
* **api:** hold a device's heat levels against the highest total ([3d8ff5f](https://github.com/JensPenneman/trail/commit/3d8ff5fef4e3e88a97c577a981d8bcb045dce6aa))
* **api:** no body decompressed or parsed before its token, one HTTPS rule for all ([1f2d8ca](https://github.com/JensPenneman/trail/commit/1f2d8ca9570f601faee8fdb84697b34886f7c54d))
* **api:** no start with an https:// address and no trusted proxy ([3bb476a](https://github.com/JensPenneman/trail/commit/3bb476ac21c086967c6ea0314be7f189af3f9335))
* **api:** stop the heat fill while it waits for a device's lock ([18e4fb4](https://github.com/JensPenneman/trail/commit/18e4fb494dcc9a0736864a7ec4c07a26d39dcd8f))
* **api:** tables keyed by what a phone or a map sends find their own entries only ([6a8e6b6](https://github.com/JensPenneman/trail/commit/6a8e6b6008c1a3c38581d97c4347ab9f36b98a41))
* **api:** the GeoJSON export keeps a phone's value where its column is empty ([048bf6f](https://github.com/JensPenneman/trail/commit/048bf6f29f3e806b514baa7540ee0881938e6db6))
* **api:** the logs drop the OsmAnd format's values below its path too ([c2becd6](https://github.com/JensPenneman/trail/commit/c2becd6c04b1fab4c9e318731aab9d9e132255e5))
* **api:** the logs drop the OsmAnd values of any path the endpoint's name starts ([c1579b3](https://github.com/JensPenneman/trail/commit/c1579b3e53814d6b9ec54ad69ea095c3049d48ce))
* **api:** tokens redacted before a preview is cut, region actions storable after the cut ([9dfcdf2](https://github.com/JensPenneman/trail/commit/9dfcdf2c4da2ec957a6048d22422f2e880169571))
* **api:** Traccar Client 9's JSON batches up to 1 MB on the OsmAnd endpoint ([63af681](https://github.com/JensPenneman/trail/commit/63af681535ff777c6d67fa02f133a21500172090))
* **api:** trail recompute holds a device only for its heat cells ([a8f931e](https://github.com/JensPenneman/trail/commit/a8f931e1b773ba235c92db2ccf4eaba402f5e7ae))
* **map:** a stop's own points and spread, connectors where segments do not meet ([70907d7](https://github.com/JensPenneman/trail/commit/70907d7d14368eb3024bdaaeaf380443733d557a))
* OwnTracks' iPhone link sends a bearer header, and a battery-saving variant ([5eb4d23](https://github.com/JensPenneman/trail/commit/5eb4d23c4efe9ca1da082bfe7a82e4a2dc431492))
* **processing:** a far fix, a walking reading and sparse points keep a stay whole ([9e9a7ef](https://github.com/JensPenneman/trail/commit/9e9a7ef673829a9249dad9e8e08ae2650748f516))
* **processing:** a walking fix, a sparse fix and a far one keep a stay whole ([213c13b](https://github.com/JensPenneman/trail/commit/213c13bca6b64ce78909b2b8d32bff594298ab12))
* **processing:** a window knows whether a stop came since the toggle began ([0f2e277](https://github.com/JensPenneman/trail/commit/0f2e2776319a2003d151ca5e39d6d6c568583a06))
* **processing:** a window sees both ends of a gap, and forgets old visits ([25d73c7](https://github.com/JensPenneman/trail/commit/25d73c7038f578969209b6b24cb05573d0ad09e6))
* **processing:** merged visit reports, kept tails, rides matched afresh ([5b8413a](https://github.com/JensPenneman/trail/commit/5b8413a8726ec836ecdc8734dd86c23a6273f310))
* **processing:** one far fix joins two stays, a ride 400 m away does not ([0184199](https://github.com/JensPenneman/trail/commit/01841997b1a7b824f2c7b339999ac2f07359654e))
* **processing:** read a cut part's points from one key range, nothing joined ([a8e6670](https://github.com/JensPenneman/trail/commit/a8e6670afa9c37994c7d4c99e39de0fc50097cbe))
* **processing:** stays within cut-out travel, linear joins, lone points ([1e64215](https://github.com/JensPenneman/trail/commit/1e6421510497d4806144939eb4c2337e3a651799))
* **processing:** stops end when the phone leaves, and none holds travel ([61c1e38](https://github.com/JensPenneman/trail/commit/61c1e389f851ca968f05b5cb5c3e9eb6b2e2a60f))
* **processing:** window edges count their own and reach back over real gaps only ([29158a8](https://github.com/JensPenneman/trail/commit/29158a87a693e9e9a7c198bfe1dd05fe8f6c2ebc))
* stops that end when the phone leaves, and nobody vanishes from the map ([#53](https://github.com/JensPenneman/trail/issues/53)) ([fd2e158](https://github.com/JensPenneman/trail/commit/fd2e1582c45d5fc910795f9076b1f2dec28bdfd5))
* **tracks:** a segment's line starts at its first point ([043b005](https://github.com/JensPenneman/trail/commit/043b0057eb0c84d9f1a5d065cb2ac69c37dcb46e))
* **transport:** a quick toggle ends at a move of another kind of travel ([0e4c982](https://github.com/JensPenneman/trail/commit/0e4c982045be9212f3027b6565524610833c1f43))
* **transport:** a quick toggle runs until a stop of ten minutes or more ([caf0077](https://github.com/JensPenneman/trail/commit/caf0077ec5172c30c76587e08e500826c4189c16))
* **transport:** a toggle's first move is its own, all its parts ([42b610f](https://github.com/JensPenneman/trail/commit/42b610f45801badb54c5148853be5c98f79b1f8a))
* **web:** a small heatmap view keeps its busiest cell apart ([c512332](https://github.com/JensPenneman/trail/commit/c51233216e972d2e3dfa998df96eba4fb6b939e0))
* **web:** drop History's camera move on another day, keep up with uploads ([3eaf040](https://github.com/JensPenneman/trail/commit/3eaf040120e3e6bb8f6dbc05f4debe708789ab6b))
* **web:** heat squares stop growing past map zoom 15 ([71106af](https://github.com/JensPenneman/trail/commit/71106af65304314689f1cff55e93d0b120caf948))
* **web:** honest coarse cards, one device's day, History's camera, two lines ([74ac3ad](https://github.com/JensPenneman/trail/commit/74ac3ade6c267ddb2a5577c73f739b4fb84e8a39))
* **web:** opaque heat squares over every shape and under every name ([0c1e6e1](https://github.com/JensPenneman/trail/commit/0c1e6e1d38c93783e3782ecbc9211a8a95f50bef))


### Documentation

* a release's 300-minute gate, no bypass while it waits, the node's risks ([6227186](https://github.com/JensPenneman/trail/commit/6227186c7b25b39fb8b8eb1d515e64c528f298c9))
* a toggle's end, a walk under one visit, stays a known departure vouches for ([60c13ca](https://github.com/JensPenneman/trail/commit/60c13ca12cecff8663eebf24ebc5cfa864963e87))
* **api:** the failed-token budget is consulted after the lookup ([07b9bbb](https://github.com/JensPenneman/trail/commit/07b9bbb2e24489cb187bf19ec3aead273cf29221))
* heat levels checked at every start, the squares' layer and colours ([5570743](https://github.com/JensPenneman/trail/commit/5570743fee6f4e13d1e523cbd4ec5f9e11650f06))
* heat levels held against the highest, squares that stop growing ([06d1f01](https://github.com/JensPenneman/trail/commit/06d1f0103f5d9047380f9212287bea30345ec492))
* People about people, Devices about what devices send ([868913e](https://github.com/JensPenneman/trail/commit/868913e9c07151b87906decfa745376638df07bb))
* setting up a phone with every app, and each protocol's ingest ([63ea0bd](https://github.com/JensPenneman/trail/commit/63ea0bdfc9184acb04d19ec9813e6445322e4038))
* stays kept within cut-out travel, windows reaching back over a gap ([4a66373](https://github.com/JensPenneman/trail/commit/4a6637390af0d6f32f0a850efdac3fee8a3f9c4e))
* stops that end when the phone leaves, transfers, gaps, the map ([0d06d8e](https://github.com/JensPenneman/trail/commit/0d06d8e4a4317c41b0695cd17d22dbf6fc99fa3b))
* the cards' two lines as measured, coarse shares, a day of one device ([706427b](https://github.com/JensPenneman/trail/commit/706427b356e7233c7a698b8b49988ddc75d88960))
* the checks on the Launchway node, the release gate and the branch rules ([69461fd](https://github.com/JensPenneman/trail/commit/69461fdd908e5a645706cacf1a0baae376e653da))
* the heatmap's levels, scale and squares in the architecture ([bdbd733](https://github.com/JensPenneman/trail/commit/bdbd7331da2c833bee2053b241cacb21d7da1295))
* the iPhone's tracking choice and header in the dashboard and e2e sections ([3f69faa](https://github.com/JensPenneman/trail/commit/3f69faa08abebd279ea356c9355c3c001d59b5cb))
* the review's fixes — HTTPS by the phones' address, bounded reads, the iPhone ([a670db7](https://github.com/JensPenneman/trail/commit/a670db7876e74f62e7a7ecbcdf6303e6dd4659d5))
* the unit tests under a CPU quota, and the web project's pool ([f4b82a9](https://github.com/JensPenneman/trail/commit/f4b82a94bfbddaaed97bc003a66e60388beb962d))
* when a walk is a move and when a stop's path, ends that do not meet ([fd48371](https://github.com/JensPenneman/trail/commit/fd48371d8cb72032504fb3b1a5ced010775eb6da))
* which keys are left out of what a phone sends, as the code has them ([9c4eb8a](https://github.com/JensPenneman/trail/commit/9c4eb8a32a754458b4c31dea4644c8e74a5d95c7))

## [0.4.0](https://github.com/JensPenneman/trail/compare/v0.3.0...v0.4.0) (2026-10-27)


### Features

* a data access log of who reads or changes whose data ([#47](https://github.com/JensPenneman/trail/issues/47)) ([94f743b](https://github.com/JensPenneman/trail/commit/94f743bd554849ee2d644ad8ae3237e9691dccc2))
* **api:** account preferences, set with PATCH /api/me ([0456391](https://github.com/JensPenneman/trail/commit/045639111aad58d56d2989a096e667864cd0f1c8))
* **api:** Insights, statistics of how the owner travelled ([948d167](https://github.com/JensPenneman/trail/commit/948d167a6e854b72067002997d0bff4ba1080920))
* **api:** record who reads or changes whose data ([fca9336](https://github.com/JensPenneman/trail/commit/fca933635d609087f8c65073092276110e654871))
* **api:** the access log of one actor, and its days by channel ([ec46dc6](https://github.com/JensPenneman/trail/commit/ec46dc6ca28604975c6844d1359dc78316ccea9b))
* **api:** the data access log under /api/v1/access-log ([a928721](https://github.com/JensPenneman/trail/commit/a9287210f035c8bb8ff91e641273d450d6922c87))
* Insights, statistics of how you travelled, with accessible charts ([#49](https://github.com/JensPenneman/trail/issues/49)) ([9ee2b97](https://github.com/JensPenneman/trail/commit/9ee2b972eaeb13cfb1246c64e0a1fce5d1b53a49))
* People is the home page, with the map and everyone who shares ([#46](https://github.com/JensPenneman/trail/issues/46)) ([8cfc2fe](https://github.com/JensPenneman/trail/commit/8cfc2fed66af7be86e33e96fa39423baa20e4053))
* **processing:** way kind shares per move, versions per level ([16019c6](https://github.com/JensPenneman/trail/commit/16019c623b9c59ff69210103681470d3a86d7ebb))
* Settings as a tree of pages in the style of the iPhone, with account preferences ([#48](https://github.com/JensPenneman/trail/issues/48)) ([7102dc9](https://github.com/JensPenneman/trail/commit/7102dc97ae9f3204f7f56658cdeb63f0764b4f04))
* **web:** charts for Insights ([a2b3952](https://github.com/JensPenneman/trail/commit/a2b3952afc449e8bdc5513b5b6ccbe1dd2ab37be))
* **web:** charts in categorical colours, with axes of counts ([4de74ba](https://github.com/JensPenneman/trail/commit/4de74ba8ec04dd2dcb89ee4a2f5c8fd3929a3013))
* **web:** Insights, its tab and the way from a move to the map ([6829b2b](https://github.com/JensPenneman/trail/commit/6829b2bbe9090c5a8e901c68ec264bddedb112d1))
* **web:** People is the home page, with the map and everyone who shares ([6eafd00](https://github.com/JensPenneman/trail/commit/6eafd0062bd8de49751b06219aff2336d017796d))
* **web:** Settings as a tree of pages, in the style of the iPhone ([3ccbb1f](https://github.com/JensPenneman/trail/commit/3ccbb1ff9c408d2440255414a1ffc263466460ea))
* **web:** Who viewed you, a page per viewer, and the access log ([9f612ae](https://github.com/JensPenneman/trail/commit/9f612aef86c82edf057f8febb6e1e69fd071e0b4))
* Who viewed you, the access log and the use of tokens, links and shares ([#50](https://github.com/JensPenneman/trail/issues/50)) ([a7774a0](https://github.com/JensPenneman/trail/commit/a7774a0fb6dbf0988d60081711d0fbc9e702635c))


### Bug Fixes

* **api:** a 6to4 visitor is the /24 of the IPv4 address it carries ([28bdfc2](https://github.com/JensPenneman/trail/commit/28bdfc2b6a1bf70380d41e74204f3fe5abf1ac6b))
* **api:** a token's people reads in its own log, an agent's look as People ([985bc28](https://github.com/JensPenneman/trail/commit/985bc28e4e89006de2ccf029a3ff17164104ee1d))
* **api:** access log ids and cursors without the table's sequence ([62af7b6](https://github.com/JensPenneman/trail/commit/62af7b60bb4e81c61cb9bafa619a752bb88d224b))
* **api:** audit:read needs a token for every device ([78d2b63](https://github.com/JensPenneman/trail/commit/78d2b639f749b95b99c302bd14259811add8f55d))
* **api:** fold limits per actor and per network, with the devices kept ([21a64b4](https://github.com/JensPenneman/trail/commit/21a64b4815eabe766dc9e7d16dbf8548c28ccbd0))
* **api:** no new names after a share ends, and current names cleaned ([940edff](https://github.com/JensPenneman/trail/commit/940edff9e3b8ec244558d9fc7d3f3d7c5fc8e317))
* **api:** the recorder refuses unknown actions and resources, and keeps going ([5db1d8c](https://github.com/JensPenneman/trail/commit/5db1d8cd23d5be0e8c2556b8bf4fc31e336d02ac))
* **api:** the summary's period by local day, like its series ([2c6f12a](https://github.com/JensPenneman/trail/commit/2c6f12a7cc9f9c99fd4f4714c5e1cedb158c5111))
* **auth:** Strict session cookies, refused from other sites' pages ([337bc12](https://github.com/JensPenneman/trail/commit/337bc1270480ebb7b3b8ef5c8220a959e12191b6))
* **web:** a person's initials stay readable in the people filter ([218065e](https://github.com/JensPenneman/trail/commit/218065ef29c5ba3bcf930612c16a28fb534e7aa1))


### Documentation

* Insights in the architecture, the guides and the plan ([83a6dc1](https://github.com/JensPenneman/trail/commit/83a6dc184375a077d4fa1fdb1fb9fb1656bb39c3))
* People is the home page ([c1ca333](https://github.com/JensPenneman/trail/commit/c1ca3334b18356cd9e7073079c0d57c7767834c3))
* plan for the people home page, settings, the access log and insights ([bf67c2c](https://github.com/JensPenneman/trail/commit/bf67c2c80e0d02a1faec761806bdd36b81125e53))
* plan for the people home page, settings, the access log and insights ([#44](https://github.com/JensPenneman/trail/issues/44)) ([4439fc8](https://github.com/JensPenneman/trail/commit/4439fc86c04e24caafeacc582fba4fd5e0c5abaf))
* Settings as a tree of pages, and the account's preferences ([96f3e1b](https://github.com/JensPenneman/trail/commit/96f3e1be5e1478fe8f5e7658662b62d93cdae521))
* the access log's pages in the architecture, the guides and the plan ([66f07ea](https://github.com/JensPenneman/trail/commit/66f07ea8f8a1d4971ddebe3fa084c9556f5317ce))
* the data access log is §8.8 of the architecture, after Insights ([89e3747](https://github.com/JensPenneman/trail/commit/89e3747af8771ff85201d1b42c54a9b0c145c948))
* the data access log, its threat model and what was settled ([68384b0](https://github.com/JensPenneman/trail/commit/68384b0a5b2f2f7098ffc2a38083ee99ceda8c02))
* the plans' rules in the architecture, and the plans gone ([9660929](https://github.com/JensPenneman/trail/commit/9660929bc3e4406a89af302b77be851195546fca))

## [0.3.0](https://github.com/JensPenneman/trail/compare/v0.2.0...v0.3.0) (2026-10-27)


### Features

* **api:** API tokens and the remaining v1 read operations ([#37](https://github.com/JensPenneman/trail/issues/37)) ([1ce04c6](https://github.com/JensPenneman/trail/commit/1ce04c625cf08d818334a80faf36fd67f15639ab))
* **api:** API tokens with scopes, device and address restrictions ([cee1607](https://github.com/JensPenneman/trail/commit/cee1607a6feecb7f39062471de08a8837e0abf19))
* **api:** get_people on the MCP server, through the sharing rules ([cf86aba](https://github.com/JensPenneman/trail/commit/cf86abae3540341931a21707e465c41a5096216a))
* **api:** MCP server on /mcp for agents ([f53b3cc](https://github.com/JensPenneman/trail/commit/f53b3ccb855d1a1ad63620bd32fa3a70a35bd0ee))
* **api:** optional satellite imagery for the map ([200c59b](https://github.com/JensPenneman/trail/commit/200c59b60ea1e24b06693bb8538b41c6951c115e))
* **api:** public API v1 with a route registry, OpenAPI document and reference ([aeb2994](https://github.com/JensPenneman/trail/commit/aeb2994b347fb256a526581a2d68821b486e6030))
* **api:** public API v1 with a route registry, OpenAPI document and reference ([#25](https://github.com/JensPenneman/trail/issues/25)) ([f7b3e84](https://github.com/JensPenneman/trail/commit/f7b3e840dbf1517b45aabdd4bad11067f8def076))
* **api:** shares, share links and a server key in the database ([c8f0c76](https://github.com/JensPenneman/trail/commit/c8f0c760bdfd765305bee3c59558a15c438d0d0d))
* **api:** sharing rules, coarse positions and the share lifecycle ([bdaa45d](https://github.com/JensPenneman/trail/commit/bdaa45d0df110b964a8df8d589ddb61668d7c57e))
* **api:** v1 operations that take any API token ([db0949c](https://github.com/JensPenneman/trail/commit/db0949c713d4f827b141ab9cf66cbb7c47f5c344))
* **api:** v1 people, shares and share links, and the public share endpoint ([02cb165](https://github.com/JensPenneman/trail/commit/02cb165c20c9413cb63f4db9f11e34747978f570))
* **api:** v1 points, history and device changes ([8af0055](https://github.com/JensPenneman/trail/commit/8af0055872367994b950f6443edde37b67fba2bc))
* **contracts:** sharing with people and public links ([e7c86ca](https://github.com/JensPenneman/trail/commit/e7c86ca30889582ec00784ac51a277c7fe23ebed))
* **contracts:** the tools of the MCP server ([9d13920](https://github.com/JensPenneman/trail/commit/9d13920dcd06a62e9c212a9535227ec160f21df5))
* location sharing with people and public links ([#35](https://github.com/JensPenneman/trail/issues/35)) ([6306f58](https://github.com/JensPenneman/trail/commit/6306f58e991bf01c9af6b7f9a21a0c9b2ff35db4))
* MCP server for agents on /mcp ([#39](https://github.com/JensPenneman/trail/issues/39)) ([3750678](https://github.com/JensPenneman/trail/commit/3750678c1d009adf2aaf7a16cae1aa72c7b4699f))
* one Map page for Live, History and Heat, and a map-centred navigation ([#41](https://github.com/JensPenneman/trail/issues/41)) ([229ccca](https://github.com/JensPenneman/trail/commit/229cccad9c7924743af67cf80cc07cf9b76f6c6e))
* **processing:** averaged, mapped and inferred levels as pure stages ([d7f671f](https://github.com/JensPenneman/trail/commit/d7f671f812c1e3eab8e81a9afa332c972e521e25))
* **processing:** levels, transport-mode inference, corrections and the timeline ([#38](https://github.com/JensPenneman/trail/issues/38)) ([3bb2e3d](https://github.com/JensPenneman/trail/commit/3bb2e3d1d020330c466175d71de5c67058670fab))
* **processing:** storage, worker, map data and the v1 routes ([98af785](https://github.com/JensPenneman/trail/commit/98af785b7fafdfd5861e925eb849acff9bdb5941))
* **sharing:** owners confirm who signed up with a pending address ([cb6b003](https://github.com/JensPenneman/trail/commit/cb6b003f9af3982645e9129cdf14d52ca6bf8861))
* **sharing:** show what shared devices are doing, from processing ([8b73ee4](https://github.com/JensPenneman/trail/commit/8b73ee4ff7ff53cdfc4e8f1f10ce3ef34e65f202))
* **web:** API tokens in Settings ([f165d3e](https://github.com/JensPenneman/trail/commit/f165d3e51577b4aa2e1d267a42b55051c6156459))
* **web:** levels, transport modes, the timeline and the quick toggle ([a9414e1](https://github.com/JensPenneman/trail/commit/a9414e16b7d067ae8d0160d033577b8004937f0d))
* **web:** one Map page for Live, History and Heat, with people and map styles ([22afd9e](https://github.com/JensPenneman/trail/commit/22afd9e300b6643565e93ebe60d9ad12b7df285a))
* **web:** People, sharing dialogs, public links and the link page ([000273c](https://github.com/JensPenneman/trail/commit/000273c6c53e3bded3156097ac7a6d0be01cec65))
* **web:** settings sections at addresses of their own ([240529b](https://github.com/JensPenneman/trail/commit/240529bdafef0a807fa236dca8899e4e0020af2f))
* **web:** the MCP guide from Settings › API tokens ([605e103](https://github.com/JensPenneman/trail/commit/605e103f1bc8cbe0f6e559b74dcebc73261218b1))


### Bug Fixes

* **api:** a month of 31 local days fits one MCP call ([56b8347](https://github.com/JensPenneman/trail/commit/56b8347b4fcc12b31c4eefb1fd36a3a96449df40))
* **api:** administration takes a passkey session ([2d11a94](https://github.com/JensPenneman/trail/commit/2d11a94e257ff3272a8664a48cb775d413e25c45))
* **api:** compare device ids without regard to case ([58349c1](https://github.com/JensPenneman/trail/commit/58349c1b8059b5c9116f2c581c17b8b1637caef7))
* **api:** load no session for public v1 routes ([50ebff8](https://github.com/JensPenneman/trail/commit/50ebff82449991d0e0eac7de1a090bb226e3457e))
* **api:** MCP device mode with locations:read, names as answers show them ([a94c1a5](https://github.com/JensPenneman/trail/commit/a94c1a5a3c0d0a61eb687c52304f7cb2a0b94871))
* **api:** mode corrections need locations:read as well ([ed8fdf1](https://github.com/JensPenneman/trail/commit/ed8fdf146d0f2ec4a0b8c9dac2150cf48d5d0a93))
* **api:** mount the shared per-IP limiter where the v1 and /docs routers are mounted ([97e264a](https://github.com/JensPenneman/trail/commit/97e264a095b782735a05f9e2018d707b11c9fd8b))
* **api:** no full stop after the token placeholder ([c7f3319](https://github.com/JensPenneman/trail/commit/c7f331914721f84d93152b1714436842ab2440eb))
* **api:** one failed-token budget for /api/v1 and /mcp ([ffa69c9](https://github.com/JensPenneman/trail/commit/ffa69c94bdf4404b4a365e8aafd37cb750d28392))
* **api:** one JSON-RPC message per MCP request ([2cdf9fa](https://github.com/JensPenneman/trail/commit/2cdf9fa2fe7316ed9cf7f4fadcd037bf32fb0b06))
* **api:** read API tokens from the Bearer scheme only ([6f01348](https://github.com/JensPenneman/trail/commit/6f013485f3e470e65a41468ed04a1c4619fb7158))
* **api:** redact share link secrets sent as query parameter names ([40e18aa](https://github.com/JensPenneman/trail/commit/40e18aad07548a91c0eaf7d1d4efce13f3c21da9))
* **api:** show positions only with locations:read ([d04fe29](https://github.com/JensPenneman/trail/commit/d04fe2961dd7b34ed7b85dfc1c91a86899db3197))
* **api:** v1 points carry the documented fields only ([a00db02](https://github.com/JensPenneman/trail/commit/a00db02b9871b4eeeda4c0c01b6dd74e197c2194))
* **api:** visits and the heatmap need locations:read ([37dbd96](https://github.com/JensPenneman/trail/commit/37dbd962f9415d954ec8c68fd56ac27b44bfff06))
* **contracts:** MCP times and dates have a length ([cefd0f9](https://github.com/JensPenneman/trail/commit/cefd0f99996d0e6bec1ac47757a8fcaa507b1eed))
* **deploy:** cap the app's V8 heap below its memory limit ([09f4ece](https://github.com/JensPenneman/trail/commit/09f4ece479050d101140c8ceafc59208553a3c77))
* **deps:** declare jsdom next to vitest, which loads it ([a2d6458](https://github.com/JensPenneman/trail/commit/a2d64580ebb66ea49547c311027fa3b4f2f1c5df))
* **dev:** check the container's Playwright against the lockfile ([2528352](https://github.com/JensPenneman/trail/commit/252835241f95df47858e2b267070bebc114e7c46))
* **dev:** devc.sh passes standard input to the command ([4a25d32](https://github.com/JensPenneman/trail/commit/4a25d32090b66e1cb8af4f9f0b0afb0b586066f1))
* **dev:** keep a stopped stack's start out of the command's output ([c6328f4](https://github.com/JensPenneman/trail/commit/c6328f479a0d63165fc2e480328b09ff83f332cb))
* **dev:** reinstall the container's modules for any command ([106770b](https://github.com/JensPenneman/trail/commit/106770b35ef1a51194922e9dfa8c15fde6a2389e))
* keep public link secrets out of every URL ([1b10757](https://github.com/JensPenneman/trail/commit/1b107576e2065b3c385614e8ef406fa3caadf32f))
* **processing:** a window made ready is ready by the worker's clock ([5bf35f4](https://github.com/JensPenneman/trail/commit/5bf35f456ea573beb4573218176fc1c859e935b7))
* **processing:** fetch map tiles again after PROCESSING_OSM_TTL_DAYS ([4ed9194](https://github.com/JensPenneman/trail/commit/4ed9194fbfa781fb4c853c7e9f90c86941cd9ffd))
* **processing:** keep where people were out of the log and the User-Agent ([70a03d8](https://github.com/JensPenneman/trail/commit/70a03d824896097a2a34f18bd4991e20e6a2c31c))
* **sharing:** give each owner one grid that no combination narrows ([2d7eab7](https://github.com/JensPenneman/trail/commit/2d7eab74af7f98847ed5bffc6ec9241ded328c39))
* **sharing:** keep a hidden person hidden in their later shares ([1e30e25](https://github.com/JensPenneman/trail/commit/1e30e25bd645e9d5377a94ceb750a4ef5fa40e0b))
* **sharing:** links run an hour at least, list at most 50, no name ([d1c649a](https://github.com/JensPenneman/trail/commit/d1c649acfeb887d1cb784a155510fa2ed82f52aa))
* **sharing:** need locations:read for anything that can yield positions ([b5783fe](https://github.com/JensPenneman/trail/commit/b5783fe3511692d17320e607d499224eb83570f0))
* **web:** /settings#__proto__ opens Profile, not a missing section ([1ac85d3](https://github.com/JensPenneman/trail/commit/1ac85d3c0c11643be4476c90e448b5cd96bb6e1b))
* **web:** a motion or trip mode called constructor reads as an unknown one ([e2ce3e8](https://github.com/JensPenneman/trail/commit/e2ce3e8923418cbbf9f44dd5f598beb0c487b993))
* **web:** forget a sign-out once the tab finds a session again ([331c96e](https://github.com/JensPenneman/trail/commit/331c96e3e64109d3cd1e76c7672dcd1dbfeb5d76))
* **web:** go to the sign-in page without a return path after signing out ([ffb4127](https://github.com/JensPenneman/trail/commit/ffb4127a802e93a978541688f9361f2f1971a2b6))
* **web:** go to the sign-in page without a return path after signing out ([#32](https://github.com/JensPenneman/trail/issues/32)) ([046d628](https://github.com/JensPenneman/trail/commit/046d628fe3a99060c33ed66a0fbbb088c990878c))


### Performance Improvements

* **api:** read the API reference bundle at startup ([106b34d](https://github.com/JensPenneman/trail/commit/106b34dfc206da94d78fd5f272363d14b2c1db06))
* **processing:** map data a piece at a time, none for flights ([6d3ab39](https://github.com/JensPenneman/trail/commit/6d3ab39b5c8be796e348bf2f9a6691b084e6cd1b))


### Documentation

* API tokens and the v1 history operations ([192b286](https://github.com/JensPenneman/trail/commit/192b2862fbfd767c376835b6304508d1d15ca631))
* **api:** name the heatmap and turning a link off ([bfeecfa](https://github.com/JensPenneman/trail/commit/bfeecfab667e0101ae104c05b0ff5b0f3996b203))
* **api:** which clients the MCP endpoint's 2025 leg serves ([a74ab86](https://github.com/JensPenneman/trail/commit/a74ab869e505fa889bfbc965905dd141cca512cc))
* **api:** why API tokens get a fast hash ([1a72463](https://github.com/JensPenneman/trail/commit/1a724632b83a9578b769a9acd6fafde300dc0299))
* batches are refused on /mcp ([1ca1f50](https://github.com/JensPenneman/trail/commit/1ca1f505cd37d72e6cf2d0a028078bb72f881dfc))
* **dev:** a command has devc.sh's standard input and output to itself ([e5d76e2](https://github.com/JensPenneman/trail/commit/e5d76e2cdb9291b4dae235f1f88699cfa6af4547))
* **dev:** the browser download has a size check only ([f77c328](https://github.com/JensPenneman/trail/commit/f77c328ed03b33533d5ee7e5ec8e2f4685f39c98))
* **dev:** the development container in the specification ([142f850](https://github.com/JensPenneman/trail/commit/142f850cae91017b75433d9db713b37104c4e56a))
* **dev:** what Playwright verifies of its own download ([1965c4f](https://github.com/JensPenneman/trail/commit/1965c4fb0b59fbf0fbfc8570743e2b0d8d156411))
* get_people in the MCP guide and the specification ([8567172](https://github.com/JensPenneman/trail/commit/8567172644b5fd148b76a654a9e23fd5eab1b41c))
* housekeeping from the platform plan ([d8d3503](https://github.com/JensPenneman/trail/commit/d8d35034bae73cc3cae7c20393313679533e11d2))
* MCP clients in general first, the mode with locations:read, get_people's reads ([a23a61a](https://github.com/JensPenneman/trail/commit/a23a61aaf1d11bd7e3df1089e78f6a76646f7323))
* name clients only where the MCP guide shows how to connect ([d38fa4e](https://github.com/JensPenneman/trail/commit/d38fa4e05adedfef057be72fb573998d15200b38))
* **ops:** a preview's database after a regenerated migration ([0196645](https://github.com/JensPenneman/trail/commit/019664546584d237d1cf17cb31a67f59bd6d797a))
* **ops:** API token audit lines and allowlists behind the edge ([0184623](https://github.com/JensPenneman/trail/commit/018462328109aaf7ac4fd25bcf16dda076867573))
* other Authorization schemes and the shared refused-token budget ([72dfac5](https://github.com/JensPenneman/trail/commit/72dfac5b59a3eb8d17d47b94e1160b55bd9c30d5))
* platform plan for api v1, tokens, processing, sharing, mcp and navigation ([3e8c01b](https://github.com/JensPenneman/trail/commit/3e8c01b5c7fbb7d4488781027cf08b5eeb70242f))
* platform plan for api v1, tokens, processing, sharing, mcp and navigation ([#22](https://github.com/JensPenneman/trail/issues/22)) ([8b56b18](https://github.com/JensPenneman/trail/commit/8b56b18689b3624a9e102f22925b4b6c76cfde7c))
* processing and transport inference ([0d1fe44](https://github.com/JensPenneman/trail/commit/0d1fe449d62bd07adcaedcee13846857203bd764))
* **processing:** list the new processing tests ([0bd0301](https://github.com/JensPenneman/trail/commit/0bd0301a6117f44338cdb13f066e4c95b26a10c0))
* **processing:** two wrapped lines that GitHub showed as list items ([619db45](https://github.com/JensPenneman/trail/commit/619db458d9d69ec3bfc87104f65d0e47d24be5af))
* public API v1 in the specification and the README ([e21cd56](https://github.com/JensPenneman/trail/commit/e21cd56f31114a9d4ec407b962eb13571f08b935))
* reflow the token and MCP tool paragraphs ([920e231](https://github.com/JensPenneman/trail/commit/920e231905541fc1912fb1280b14bc19e7100529))
* say what the MCP guide can stand behind ([2fe4765](https://github.com/JensPenneman/trail/commit/2fe4765c0b780698260fa72fe45c9d20c955999e))
* **security:** what an agent sees of people who share ([ba05ac2](https://github.com/JensPenneman/trail/commit/ba05ac2d85b71b4f8748535930db0706a4c17e32))
* sharing in the specification, the API guide, the plan and a user guide ([5f9f5f6](https://github.com/JensPenneman/trail/commit/5f9f5f680ffb380ed3852bc8f3ebb8a3f65f6f87))
* **sharing:** one grid per owner, confirmation, scopes and links ([28062c6](https://github.com/JensPenneman/trail/commit/28062c6a2d0d91119efa21935ddb180248a3a6da))
* **sharing:** sharing is section 8.5, after API tokens ([b56ba1b](https://github.com/JensPenneman/trail/commit/b56ba1b9eda4209932b7fda7d2d42d6c7b39c9c8))
* the Map page, the navigation and settings sections ([9f11f87](https://github.com/JensPenneman/trail/commit/9f11f872b936bb01b584c04c8995442c5811f22a))
* the MCP server ([4c2787d](https://github.com/JensPenneman/trail/commit/4c2787de7970ce288966f425020ca6d169ba6fab))

## [0.2.0](https://github.com/JensPenneman/trail/compare/v0.1.0...v0.2.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* **deploy:** Launchway's Compose file list for Trail must be only deploy/compose.yaml, and production must set COMPOSE_PROFILES=production (otherwise no backups run). The standalone stack is no longer supported.

### Features

* **api:** export visits and trips ([9ad9ea9](https://github.com/JensPenneman/trail/commit/9ad9ea93b3ee01d71fb77058385c1721266791ba))
* **api:** overland ingest, passkey auth and dashboard api ([1ae07ed](https://github.com/JensPenneman/trail/commit/1ae07edec733a13ac72a1d515f667c2fc8d4f4cd))
* balanced+ records every point at best accuracy ([bc45712](https://github.com/JensPenneman/trail/commit/bc457128801ce39a6463539c86b51a77db117127))
* balanced+ records every point at best accuracy ([#6](https://github.com/JensPenneman/trail/issues/6)) ([61a28d6](https://github.com/JensPenneman/trail/commit/61a28d620068d30d4b41f91a25f97dfcdfae5ca6))
* balanced+ remote settings preset ([801bbfc](https://github.com/JensPenneman/trail/commit/801bbfc606ec6825527fb4df2449f0d237a7a0ce))
* balanced+ remote settings preset ([#3](https://github.com/JensPenneman/trail/issues/3)) ([5a6d9dd](https://github.com/JensPenneman/trail/commit/5a6d9dd42173c2a7fc2bbf6f3c012daf5377bde4))
* **deploy:** compose override for deployments through Launchway ([3e560ee](https://github.com/JensPenneman/trail/commit/3e560ee3fc22b8d60d5b2bcbfeb688e0cb62c6c6))
* **deploy:** one compose file for Launchway production and previews ([68f8797](https://github.com/JensPenneman/trail/commit/68f87975a0cbb595df0d72055434b0616e690501))
* **deploy:** run behind a shared reverse proxy ([2193da7](https://github.com/JensPenneman/trail/commit/2193da7668c2a270bb5ad685d5a61e932363cc52))
* **deploy:** run behind a shared reverse proxy ([#2](https://github.com/JensPenneman/trail/issues/2)) ([01cd411](https://github.com/JensPenneman/trail/commit/01cd411e496e8ca8177de9512a12f6b7708f90a6))
* keep every recorded row and guard data across updates ([ac4ac50](https://github.com/JensPenneman/trail/commit/ac4ac507bb52a9d57665cd3bc0ccf15e7dda6566))
* keep every recorded row and guard data across updates ([#4](https://github.com/JensPenneman/trail/issues/4)) ([293dec2](https://github.com/JensPenneman/trail/commit/293dec242d52eb63805230c0f9a7a3b344c1baeb))
* **web:** live dashboard, map history and passkey sign-in ([8348e6f](https://github.com/JensPenneman/trail/commit/8348e6ff3d6fda86413419622a0a951f24233256))


### Bug Fixes

* announce ended sessions on the event stream and sign out cleanly ([061a89d](https://github.com/JensPenneman/trail/commit/061a89dee87ac9d67539d7760cbbecd6947f2784))
* **api:** acknowledge uploads whose values postgres would refuse ([f3cd5a2](https://github.com/JensPenneman/trail/commit/f3cd5a22a42fa058633bb79b758b90e32abd29f0))
* **api:** check device tokens before the failed-token limit ([f16ca23](https://github.com/JensPenneman/trail/commit/f16ca23bc42412d9bcb307ccaf09217051cc5972))
* **api:** judge distance glitches against the previous fix ([4608acf](https://github.com/JensPenneman/trail/commit/4608acfceb4541b55148c182ccaa77370e518357))
* **api:** rate-limit the database health check ([c8a9f16](https://github.com/JensPenneman/trail/commit/c8a9f16997c7d81c6c7e7cdd12cd7f0082fdc5ec))
* **api:** rate-limit the database health check ([#5](https://github.com/JensPenneman/trail/issues/5)) ([3948d88](https://github.com/JensPenneman/trail/commit/3948d8832fce67d18faeb2050071ab6d20997ecf))
* **api:** redact one-time and spelled-out tokens from logs ([2b51a60](https://github.com/JensPenneman/trail/commit/2b51a60694d9b4632cc455f2cb11773ddc75fea8))
* **deploy:** trust only the stack's proxies and pass rate limits through ([d6b0c00](https://github.com/JensPenneman/trail/commit/d6b0c002ed35bf046e0f0a1b38eb576e654c07d7))
* **web:** keyboard-scrollable panels and tables, AAA invite tags ([2ca7138](https://github.com/JensPenneman/trail/commit/2ca7138ad7abfca8433a49dbf1fe1f3508e57299))
* **web:** leave a deleted device's page and steady the add-device dialog ([159d9a0](https://github.com/JensPenneman/trail/commit/159d9a0ce00b27218b0f9533640293e3972ca3d3))
* **web:** never fetch a device this tab knows is gone ([7c9eef2](https://github.com/JensPenneman/trail/commit/7c9eef29273aef98810fa73eeaf0b40abacb8cbb))
* **web:** never fetch a device this tab knows is gone ([#7](https://github.com/JensPenneman/trail/issues/7)) ([cb7075b](https://github.com/JensPenneman/trail/commit/cb7075bc1f5ea4e199c9661f86cc2e0804f7050e))


### Documentation

* operations runbook for Launchway releases and previews ([e58bdb0](https://github.com/JensPenneman/trail/commit/e58bdb00e6df0f2424d04798933a6041c3d89f61))
* readme, security policy and operations runbooks ([66ab6dd](https://github.com/JensPenneman/trail/commit/66ab6ddaf98afe71551d4511042be935ae074521))
* record integration and review changes in the spec ([7e469d5](https://github.com/JensPenneman/trail/commit/7e469d59effce4b6b3ce48a5d09477190e434aaf))
