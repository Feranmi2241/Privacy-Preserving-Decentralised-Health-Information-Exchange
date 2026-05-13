import { generateRSAKeyPair } from "./encryption";

const { publicKey, privateKey } = generateRSAKeyPair();

// Print as single-line JSON strings safe for .env
console.log(`RSA_PUBLIC_KEY=${JSON.stringify(publicKey)}`);
console.log(`RSA_PRIVATE_KEY=${JSON.stringify(privateKey)}`);
