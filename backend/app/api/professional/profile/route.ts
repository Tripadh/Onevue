import ProfessionalProfile from "../../../../models/ProfessionalProfile";
import { professionalContract } from "../../../../lib/domain-profile/contracts";
import { createDomainProfileHandlers } from "../../../../lib/domain-profile/handler";

const handlers = createDomainProfileHandlers("professional", ProfessionalProfile, professionalContract);

export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const OPTIONS = handlers.OPTIONS;
