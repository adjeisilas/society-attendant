/** Shared password prompt for the admin scripts. Nothing is echoed to the terminal. */

const MIN_LENGTH = 12;

export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === String.fromCharCode(3)) process.exit(130); // Ctrl+C
        if (char === String.fromCharCode(127) || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

/** Asks twice and exits with a message unless both entries match and are long enough. */
export async function promptNewPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    console.error("Run this in an interactive terminal so the password can be typed privately.");
    process.exit(1);
  }

  const password = await promptHidden(`Password (min ${MIN_LENGTH} characters): `);
  if (password.length < MIN_LENGTH) {
    console.error(`Password must be at least ${MIN_LENGTH} characters.`);
    process.exit(1);
  }
  if ((await promptHidden("Confirm password: ")) !== password) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
  return password;
}
