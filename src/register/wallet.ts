import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export interface GeneratedWallet {
  address: string;
  privateKey: string;
}

export function generateWallet(): GeneratedWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, privateKey };
}
