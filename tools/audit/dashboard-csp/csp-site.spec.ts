// site.spec.ts of the dashboard, run against the deployed origin with the CSP guard on (see playwright.config.ts). The spec is imported, not copied.
import { expect, test } from '@playwright/test';
import { installCspGuard } from './csp-guard';
import '../../../apps/dashboard/tests/site.spec';

installCspGuard(test, expect);
