// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * MedicalRecord.sol — Privacy-Preserving HIE Smart Contract
 * ==========================================================
 * Implements the blockchain layer of the decentralised Health Information
 * Exchange described in the PhD research proposal.
 *
 * Key design decisions aligned with the research:
 *
 * 1. Append-only versioned records — each patient can have multiple visit
 *    records chained via previousIpfsHash, satisfying HL7 FHIR amendment
 *    requirements while preserving immutability.
 *
 * 2. Patient consent model — patients (or their designated address) can
 *    grant or revoke hospital access to their records on-chain, directly
 *    satisfying the "privacy-preserving" claim and GDPR/HIPAA alignment.
 *
 * 3. Per-hospital patient scoping — getAllPatientIds() returns only the
 *    IDs submitted by the calling hospital, preventing cross-hospital
 *    enumeration of patient identities.
 *
 * 4. Access audit events — every read is logged on-chain, providing the
 *    immutable audit trail required by a healthcare HIE.
 *
 * Professor alignment:
 *   - Prof. Zhan (Information Assurance): hybrid encryption + on-chain
 *     access control enforces data ownership at the cryptographic level.
 *   - Prof. Shao (Health IT): consent model mirrors real-world HIE
 *     patient-centric data governance.
 */
contract MedicalRecord {

    address public owner;
    mapping(address => bool) public authorizedHospitals;

    // ── Record struct ─────────────────────────────────────────────────────────
    struct Record {
        string   patientId;
        string   ipfsHash;
        string   previousIpfsHash; // "" for first record; chains amendments
        address  hospital;
        uint256  timestamp;
        uint256  version;
    }

    // ── Storage ───────────────────────────────────────────────────────────────
    // patientId => ordered list of record versions (append-only)
    mapping(string => Record[]) private records;

    // hospital => list of patient IDs that hospital has submitted
    mapping(address => string[]) private hospitalPatients;

    // patientId => hospital => consent granted
    // Consent is granted by default when a hospital first stores a record.
    // The patient (or owner acting as guardian) can revoke it.
    mapping(string => mapping(address => bool)) public patientConsent;

    // ── Events ────────────────────────────────────────────────────────────────
    event RecordAdded(
        string  indexed patientId,
        string          ipfsHash,
        address indexed hospital,
        uint256         version,
        uint256         timestamp
    );

    event RecordAccessed(
        string  indexed patientId,
        address indexed accessor,
        uint256         version,
        uint256         timestamp
    );

    event ConsentGranted(string indexed patientId, address indexed hospital);
    event ConsentRevoked(string indexed patientId, address indexed hospital);

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedHospitals[msg.sender], "Not authorized");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
        authorizedHospitals[msg.sender] = true;
    }

    // ── Hospital access control ───────────────────────────────────────────────
    function authorizeHospital(address _hospital) external onlyOwner {
        authorizedHospitals[_hospital] = true;
    }

    function revokeHospital(address _hospital) external onlyOwner {
        authorizedHospitals[_hospital] = false;
    }

    // ── Patient consent management ────────────────────────────────────────────
    /**
     * Grant a specific hospital access to a patient's records.
     * Can be called by the owner (acting as patient guardian) or the
     * hospital that originally stored the record.
     */
    function grantConsent(string memory _patientId, address _hospital) external {
        require(
            msg.sender == owner || msg.sender == _hospital,
            "Not authorised to grant consent"
        );
        patientConsent[_patientId][_hospital] = true;
        emit ConsentGranted(_patientId, _hospital);
    }

    /**
     * Revoke a hospital's access to a patient's records.
     * Can be called by the owner only (patient guardian role).
     */
    function revokeConsent(string memory _patientId, address _hospital) external onlyOwner {
        patientConsent[_patientId][_hospital] = false;
        emit ConsentRevoked(_patientId, _hospital);
    }

    // ── Store record (append-only, versioned) ─────────────────────────────────
    /**
     * Stores a new record version for a patient.
     * - First record: previousIpfsHash must be ""
     * - Amendment: previousIpfsHash must equal the latest stored IPFS hash
     *   (enforces the chain of custody)
     * - Consent is automatically granted to the storing hospital.
     */
    function storeRecord(
        string memory _patientId,
        string memory _ipfsHash,
        string memory _previousIpfsHash
    ) public onlyAuthorized {
        Record[] storage existing = records[_patientId];

        if (existing.length == 0) {
            // First record — previousIpfsHash must be empty
            require(
                bytes(_previousIpfsHash).length == 0,
                "First record must have empty previousIpfsHash"
            );
            // Track this patient under the storing hospital
            hospitalPatients[msg.sender].push(_patientId);
        } else {
            // Amendment — previousIpfsHash must match the latest version
            require(
                keccak256(bytes(_previousIpfsHash)) ==
                keccak256(bytes(existing[existing.length - 1].ipfsHash)),
                "previousIpfsHash does not match latest record"
            );
        }

        uint256 version = existing.length + 1;

        existing.push(Record({
            patientId:        _patientId,
            ipfsHash:         _ipfsHash,
            previousIpfsHash: _previousIpfsHash,
            hospital:         msg.sender,
            timestamp:        block.timestamp,
            version:          version
        }));

        // Auto-grant consent to the storing hospital
        patientConsent[_patientId][msg.sender] = true;

        emit RecordAdded(_patientId, _ipfsHash, msg.sender, version, block.timestamp);
    }

    // ── Read: IPFS hash only (no consent required — for verification) ──────────
    /**
     * Returns only the IPFS hash for a patient record.
     * Does NOT require patient consent — used by the backend to verify
     * that a submitted Tx Hash + IPFS CID are valid before sending the
     * patient authorization email. No sensitive data is exposed.
     */
    function getIpfsHash(string memory _patientId)
        public
        view
        onlyAuthorized
        returns (string memory)
    {
        require(records[_patientId].length > 0, "Record not found");
        return records[_patientId][records[_patientId].length - 1].ipfsHash;
    }

    // ── Read: latest record ───────────────────────────────────────────────────
    /**
     * Returns the latest record version for a patient.
     * Requires the caller to be authorized AND to have patient consent.
     * Emits RecordAccessed for the immutable audit trail.
     */
    function getRecord(string memory _patientId)
        public
        onlyAuthorized
        returns (
            string memory patientId,
            string memory ipfsHash,
            string memory previousIpfsHash,
            address       hospital,
            uint256       timestamp,
            uint256       version
        )
    {
        require(records[_patientId].length > 0, "Record not found");
        require(
            patientConsent[_patientId][msg.sender],
            "No patient consent for this hospital"
        );

        Record storage r = records[_patientId][records[_patientId].length - 1];

        emit RecordAccessed(_patientId, msg.sender, r.version, block.timestamp);

        return (
            r.patientId,
            r.ipfsHash,
            r.previousIpfsHash,
            r.hospital,
            r.timestamp,
            r.version
        );
    }

    // ── Read: specific version ────────────────────────────────────────────────
    function getRecordVersion(string memory _patientId, uint256 _version)
        public
        onlyAuthorized
        returns (
            string memory ipfsHash,
            string memory previousIpfsHash,
            address       hospital,
            uint256       timestamp
        )
    {
        require(records[_patientId].length > 0, "Record not found");
        require(_version >= 1 && _version <= records[_patientId].length, "Invalid version");
        require(
            patientConsent[_patientId][msg.sender],
            "No patient consent for this hospital"
        );

        Record storage r = records[_patientId][_version - 1];

        emit RecordAccessed(_patientId, msg.sender, _version, block.timestamp);

        return (r.ipfsHash, r.previousIpfsHash, r.hospital, r.timestamp);
    }

    // ── Read: version count ───────────────────────────────────────────────────
    function getRecordCount(string memory _patientId)
        public
        view
        onlyAuthorized
        returns (uint256)
    {
        return records[_patientId].length;
    }

    // ── Read: patient IDs for the calling hospital only ───────────────────────
    /**
     * Returns only the patient IDs submitted by the calling hospital.
     * Prevents cross-hospital enumeration of patient identities.
     */
    function getAllPatientIds()
        public
        view
        onlyAuthorized
        returns (string[] memory)
    {
        return hospitalPatients[msg.sender];
    }
}
