import CreatorProfile from "../../../../models/CreatorProfile";
import { creatorContract } from "../../../../lib/domain-profile/contracts";
import { createDomainProfileHandlers } from "../../../../lib/domain-profile/handler";

const handlers = createDomainProfileHandlers("creator", CreatorProfile, creatorContract);

export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const OPTIONS = handlers.OPTIONS;
