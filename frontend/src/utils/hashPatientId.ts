import { keccak256, toUtf8Bytes } from "ethers";

export function hashPatientId(patientId: string): string {
  return keccak256(toUtf8Bytes(patientId.trim().toLowerCase()));
}
