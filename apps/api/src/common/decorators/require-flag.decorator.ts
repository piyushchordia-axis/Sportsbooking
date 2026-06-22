import { SetMetadata } from '@nestjs/common';
import { FeatureFlag } from '@sportsbooking/shared';

export const REQUIRE_FLAG_KEY = 'require_flag';

/**
 * Gate a route behind an owner feature flag (PRD §2.2). The FeatureFlagGuard
 * reads this metadata and rejects the request when the resolved owner does not
 * have the flag enabled in `owner.featureFlags`.
 */
export const RequireFlag = (flag: FeatureFlag) =>
  SetMetadata(REQUIRE_FLAG_KEY, flag);
