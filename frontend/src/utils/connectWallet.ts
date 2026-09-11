/**
 * connectWallet.ts
 *
 * Shared wallet-connect logic used by both:
 *   1. AuthPage.tsx — during the post-signup connect-wallet step
 *   2. App.tsx      — via the persistent banner for accounts that skipped it
 *
 * Keeping this in one place prevents the two call sites from drifting apart.
 */

const API = import.meta.env.VITE_API_URL as string;

export interface ConnectWalletOptions {
  /** JWT token for the authenticated session (used in Authorization header). */
  token: string;
  /** Hospital email — used as the identity key for nonce/verify calls. */
  email: string;
}

export interface ConnectWalletResult {
  success: true;
  walletAddress: string;
}

/**
 * Runs the full wallet-connect flow:
 *   1. Check MetaMask exists
 *   2. Request accounts
 *   3. Verify / switch to Sepolia
 *   4. Fetch nonce from backend
 *   5. Sign the nonce message
 *   6. Verify signature on backend
 *
 * Throws a plain Error with a human-readable message on any failure —
 * callers should catch and display it however their UI handles errors.
 */
export async function connectWallet({ token, email }: ConnectWalletOptions): Promise<ConnectWalletResult> {
  if (!window.ethereum) {
    throw new Error(
      'MetaMask (or another Ethereum wallet browser extension) is required. Install it at https://metamask.io'
    );
  }

  const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const walletAddress = accounts[0];
  if (!walletAddress) {
    throw new Error('No account found. Please unlock MetaMask and try again.');
  }

  const chainId: string = await window.ethereum.request({ method: 'eth_chainId' });
  if (chainId !== '0xaa36a7') {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }],
      });
    } catch (switchErr: any) {
      if (switchErr.code === 4001) {
        throw new Error('You must switch to the Sepolia test network to continue.');
      }
      throw new Error('Failed to switch network: ' + (switchErr.message || 'Unknown error'));
    }
  }

  const nonceRes = await fetch(`${API}/auth/wallet-nonce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email }),
  });
  const nonceData = await nonceRes.json();
  if (!nonceRes.ok) throw new Error(nonceData.error || 'Failed to get nonce');
  const message: string = nonceData.message;

  const { BrowserProvider } = await import('ethers');
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  let signature: string;
  try {
    signature = await signer.signMessage(message);
  } catch (signErr: any) {
    if (signErr.code === 4001 || signErr.code === 'ACTION_REJECTED') {
      throw new Error('Signature rejected. You must sign the message to link your wallet.');
    }
    throw new Error('Signing failed: ' + (signErr.message || 'Unknown error'));
  }

  const verifyRes = await fetch(`${API}/auth/wallet-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, walletAddress, signature }),
  });
  const verifyData = await verifyRes.json();
  if (!verifyRes.ok) throw new Error(verifyData.error || 'Wallet verification failed');

  return { success: true, walletAddress };
}
