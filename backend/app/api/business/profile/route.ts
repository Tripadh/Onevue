import BusinessProfile from "../../../../models/BusinessProfile";
import { businessContract } from "../../../../lib/domain-profile/contracts";
import { createDomainProfileHandlers } from "../../../../lib/domain-profile/handler";

const handlers = createDomainProfileHandlers("business", BusinessProfile, businessContract);

export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const OPTIONS = handlers.OPTIONS;
