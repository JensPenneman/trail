# Changelog

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
