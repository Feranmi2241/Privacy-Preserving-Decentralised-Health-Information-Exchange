import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("MedicalRecord", function () {
  let contract: any;
  let owner: HardhatEthersSigner;
  let hospital1: HardhatEthersSigner;
  let hospital2: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, hospital1, hospital2, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MedicalRecord");
    contract = await factory.deploy();
    await contract.waitForDeployment();
  });

  // ── Deployment ──────────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("auto-authorises the owner as a hospital", async function () {
      expect(await contract.authorizedHospitals(owner.address)).to.be.true;
    });
  });

  // ── Access Control ──────────────────────────────────────────────────────────
  describe("Access Control", function () {
    it("owner can authorise a hospital", async function () {
      await contract.authorizeHospital(hospital1.address);
      expect(await contract.authorizedHospitals(hospital1.address)).to.be.true;
    });

    it("owner can revoke a hospital", async function () {
      await contract.authorizeHospital(hospital1.address);
      await contract.revokeHospital(hospital1.address);
      expect(await contract.authorizedHospitals(hospital1.address)).to.be.false;
    });

    it("non-owner cannot authorise a hospital", async function () {
      await expect(
        contract.connect(stranger).authorizeHospital(hospital1.address)
      ).to.be.revertedWith("Not owner");
    });

    it("non-owner cannot revoke a hospital", async function () {
      await contract.authorizeHospital(hospital1.address);
      await expect(
        contract.connect(stranger).revokeHospital(hospital1.address)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ── storeRecord ─────────────────────────────────────────────────────────────
  describe("storeRecord", function () {
    const patientId = "PAT-001";
    const ipfsHash  = "QmTestHash123";

    it("authorised hospital can store a first record", async function () {
      await expect(contract.storeRecord(patientId, ipfsHash, "")).to.not.be.reverted;
    });

    it("emits RecordAdded event with correct fields", async function () {
      await expect(contract.storeRecord(patientId, ipfsHash, ""))
        .to.emit(contract, "RecordAdded")
        .withArgs(patientId, ipfsHash, owner.address, 1n, (ts: bigint) => ts > 0n);
    });

    it("unauthorised address cannot store a record", async function () {
      await expect(
        contract.connect(stranger).storeRecord(patientId, ipfsHash, "")
      ).to.be.revertedWith("Not authorized");
    });

    it("first record must have empty previousIpfsHash", async function () {
      await expect(
        contract.storeRecord(patientId, ipfsHash, "QmSomeOtherHash")
      ).to.be.revertedWith("First record must have empty previousIpfsHash");
    });

    it("amendment must reference the latest IPFS hash", async function () {
      await contract.storeRecord(patientId, ipfsHash, "");
      await expect(
        contract.storeRecord(patientId, "QmNewHash", "QmWrongPrevHash")
      ).to.be.revertedWith("previousIpfsHash does not match latest record");
    });

    it("valid amendment chains correctly", async function () {
      await contract.storeRecord(patientId, ipfsHash, "");
      await expect(
        contract.storeRecord(patientId, "QmNewHash", ipfsHash)
      ).to.not.be.reverted;
    });

    it("newly authorised hospital can store a record", async function () {
      await contract.authorizeHospital(hospital1.address);
      await expect(
        contract.connect(hospital1).storeRecord("PAT-002", "QmHospital1Hash", "")
      ).to.not.be.reverted;
    });

    it("revoked hospital cannot store a record", async function () {
      await contract.authorizeHospital(hospital1.address);
      await contract.revokeHospital(hospital1.address);
      await expect(
        contract.connect(hospital1).storeRecord(patientId, ipfsHash, "")
      ).to.be.revertedWith("Not authorized");
    });
  });

  // ── getRecord ───────────────────────────────────────────────────────────────
  describe("getRecord", function () {
    const patientId = "PAT-001";
    const ipfsHash  = "QmTestHash123";

    beforeEach(async function () {
      await contract.storeRecord(patientId, ipfsHash, "");
    });

    it("returns correct record fields for latest version", async function () {
      const [retId, retHash, , retHospital, retTs, retVersion] =
        await contract.getRecord(patientId);
      expect(retId).to.equal(patientId);
      expect(retHash).to.equal(ipfsHash);
      expect(retHospital).to.equal(owner.address);
      expect(retTs).to.be.gt(0n);
      expect(retVersion).to.equal(1n);
    });

    it("reverts for a non-existent patient ID", async function () {
      await expect(contract.getRecord("PAT-UNKNOWN")).to.be.revertedWith("Record not found");
    });

    it("unauthorised address cannot retrieve a record", async function () {
      await expect(
        contract.connect(stranger).getRecord(patientId)
      ).to.be.revertedWith("Not authorized");
    });

    it("hospital without consent cannot retrieve a record", async function () {
      await contract.authorizeHospital(hospital1.address);
      // hospital1 is authorized but has no consent for this patient
      await expect(
        contract.connect(hospital1).getRecord(patientId)
      ).to.be.revertedWith("No patient consent for this hospital");
    });

    it("hospital with granted consent can retrieve a record", async function () {
      await contract.authorizeHospital(hospital1.address);
      await contract.grantConsent(patientId, hospital1.address);
      await expect(contract.connect(hospital1).getRecord(patientId)).to.not.be.reverted;
    });

    it("revoked consent blocks retrieval", async function () {
      await contract.authorizeHospital(hospital1.address);
      await contract.grantConsent(patientId, hospital1.address);
      await contract.revokeConsent(patientId, hospital1.address);
      await expect(
        contract.connect(hospital1).getRecord(patientId)
      ).to.be.revertedWith("No patient consent for this hospital");
    });
  });

  // ── getAllPatientIds ─────────────────────────────────────────────────────────
  describe("getAllPatientIds", function () {
    it("returns empty array when no records exist", async function () {
      const ids = await contract.getAllPatientIds();
      expect(ids).to.deep.equal([]);
    });

    it("returns only IDs submitted by the calling hospital", async function () {
      await contract.authorizeHospital(hospital1.address);

      await contract.storeRecord("PAT-001", "QmHash1", "");
      await contract.storeRecord("PAT-002", "QmHash2", "");
      await contract.connect(hospital1).storeRecord("PAT-H1", "QmHashH1", "");

      // Owner sees only its own patients
      const ownerIds = await contract.getAllPatientIds();
      expect(ownerIds).to.deep.equal(["PAT-001", "PAT-002"]);

      // hospital1 sees only its own patients
      const h1Ids = await contract.connect(hospital1).getAllPatientIds();
      expect(h1Ids).to.deep.equal(["PAT-H1"]);
    });

    it("unauthorised address cannot call getAllPatientIds", async function () {
      await expect(
        contract.connect(stranger).getAllPatientIds()
      ).to.be.revertedWith("Not authorized");
    });
  });

  // ── Multi-hospital scenario ──────────────────────────────────────────────────
  describe("Multi-hospital scenario", function () {
    it("two authorised hospitals can each store distinct records with correct provenance", async function () {
      await contract.authorizeHospital(hospital1.address);
      await contract.authorizeHospital(hospital2.address);

      await contract.connect(hospital1).storeRecord("PAT-H1", "QmH1Hash", "");
      await contract.connect(hospital2).storeRecord("PAT-H2", "QmH2Hash", "");

      const [, , , h1Addr] = await contract.getRecord("PAT-H1");
      const [, , , h2Addr] = await contract.getRecord("PAT-H2");

      expect(h1Addr).to.equal(hospital1.address);
      expect(h2Addr).to.equal(hospital2.address);
    });
  });

  // ── Versioned records ────────────────────────────────────────────────────────
  describe("Versioned records", function () {
    it("getRecordCount returns correct version count", async function () {
      await contract.storeRecord("PAT-001", "QmV1", "");
      await contract.storeRecord("PAT-001", "QmV2", "QmV1");
      expect(await contract.getRecordCount("PAT-001")).to.equal(2n);
    });

    it("getRecordVersion returns correct version data", async function () {
      await contract.storeRecord("PAT-001", "QmV1", "");
      await contract.storeRecord("PAT-001", "QmV2", "QmV1");
      const [hash] = await contract.getRecordVersion("PAT-001", 1);
      expect(hash).to.equal("QmV1");
    });
  });
});
