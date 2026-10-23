import FreelancerProfile from "../../../../models/FreelancerProfile";
import { freelancerContract } from "../../../../lib/domain-profile/contracts";
import { createDomainProfileHandlers } from "../../../../lib/domain-profile/handler";

const handlers = createDomainProfileHandlers("freelancer", FreelancerProfile, freelancerContract);

export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const OPTIONS = handlers.OPTIONS;
