import rootPackage from "../../../../package.json" with { type: "json" };

/** Version of the product (root package.json); the Docker image overrides it with APP_VERSION. */
export const defaultAppVersion: string = rootPackage.version;

/** Commit shown when GIT_SHA is not baked into the image. */
export const defaultCommit = "dev";
