/**
 * Version of the processing algorithms. Bumping it after a change to a stage
 * or a threshold makes the server rebuild every device's derived data at boot
 * (newest days first, at low priority); every derived row records the version
 * that made it.
 */
export const processingVersion = 1;
