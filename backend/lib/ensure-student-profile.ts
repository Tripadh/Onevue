import mongoose from "mongoose";
import connectToDatabase from "./db";
import StudentProfile from "../models/StudentProfile";

interface ProfileOwner {
  _id: unknown;
  name?: string | null;
}

function profileModel() {
  return (StudentProfile as unknown as { default?: typeof StudentProfile }).default || StudentProfile;
}

function ownerObjectId(user: ProfileOwner): mongoose.Types.ObjectId {
  const value = user._id;
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  return new mongoose.Types.ObjectId(String(value));
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function baselineContacts(user: ProfileOwner) {
  const slug = user.name
    ? user.name.toLowerCase().replace(/\s+/g, "")
    : "student";
  return {
    email: "",
    phone: "",
    countryCode: "",
    city: "",
    state: "",
    country: "",
    visibility: { email: "private", phone: "private" },
    github: "",
    linkedin: "",
    twitter: "",
    portfolio: `https://onevue.id/${slug}`,
  };
}

/**
 * Links the authenticated user to exactly one student profile.
 * A profile stored with a string userId is reused and rewritten to the
 * canonical ObjectId. A second profile is not created.
 */
export async function ensureStudentProfile(user: ProfileOwner) {
  await connectToDatabase();
  const Model = profileModel();
  const userId = ownerObjectId(user);
  const userIdString = userId.toString();

  const canonical = await Model.findOne({ userId });
  if (canonical) {
    return canonical;
  }

  const legacy = await Model.collection.findOne({ userId: userIdString });
  if (legacy?._id) {
    await Model.updateOne(
      { _id: legacy._id },
      { $set: { userId } },
    );
    const repaired = await Model.findById(legacy._id);
    if (repaired) {
      return repaired;
    }
  }

  try {
    return await Model.create({
      userId,
      contacts: baselineContacts(user),
    });
  } catch (error) {
    if (!isDuplicateKey(error)) {
      throw error;
    }
    const existing = await Model.findOne({ userId });
    if (existing) {
      return existing;
    }
    throw error;
  }
}
