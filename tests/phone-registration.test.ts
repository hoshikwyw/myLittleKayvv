import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeRegistrationError,
  isTransient,
} from "@/hooks/use-app-notifications";

const REDMI =
  "java.util.concurrent.ExecutionException: java.io.IOException: SERVICE_NOT_AVAILABLE";

test("an unreachable Google is explained with what to try, and retried", () => {
  const message = describeRegistrationError(REDMI);

  assert.match(message, /could not reach Google's notification service/);
  assert.match(message, /VPN/);
  assert.match(message, /No restrictions/);
  assert.equal(isTransient(REDMI), true);
});

test("missing Play services points at the Play Store, and is not retried", () => {
  const raw = "java.io.IOException: MISSING_INSTANCEID_SERVICE";

  assert.match(describeRegistrationError(raw), /Google Play services is missing/);
  assert.equal(isTransient("MISSING_INSTANCEID_SERVICE"), false);
});

test("a configuration mismatch blames the config file, not the phone", () => {
  assert.match(
    describeRegistrationError("AUTHENTICATION_FAILED"),
    /google-services\.json/,
  );
  assert.equal(isTransient("AUTHENTICATION_FAILED"), false);
});

test("anything else is shown as it came", () => {
  assert.equal(
    describeRegistrationError("Something new"),
    "Firebase could not register this phone: Something new",
  );
});
