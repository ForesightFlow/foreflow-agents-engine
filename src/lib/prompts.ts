import readline from 'node:readline';

export function promptLine(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function promptYesNo(rl: readline.Interface, question: string): Promise<boolean> {
  const answer = await promptLine(rl, question);
  return /^y(es)?$/i.test(answer.trim());
}
