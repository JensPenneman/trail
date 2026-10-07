# Changelog

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
