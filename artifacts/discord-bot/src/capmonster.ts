import axios from "axios";

const CAPMONSTER_URL = "https://api.capmonster.cloud";
const ROBLOX_ARKOSE_PUBLIC_KEY = "476068BF-9607-4799-B53D-966BE98E2B81";

export async function solveFunCaptcha(blob: string): Promise<string> {
  const apiKey = process.env.CAPMONSTER_API_KEY;
  if (!apiKey) throw new Error("CAPMONSTER_API_KEY is not set.");

  // Submit the task
  const createRes = await axios.post(`${CAPMONSTER_URL}/createTask`, {
    clientKey: apiKey,
    task: {
      type: "FunCaptchaTaskProxyless",
      websiteURL: "https://www.roblox.com",
      websitePublicKey: ROBLOX_ARKOSE_PUBLIC_KEY,
      funcaptchaApiJSSubdomain: "roblox-api.arkoselabs.com",
      data: JSON.stringify({ blob }),
    },
  });

  const taskId: number = createRes.data?.taskId;
  if (!taskId) {
    throw new Error(
      `CapMonster did not return a taskId: ${JSON.stringify(createRes.data)}`
    );
  }

  console.log(`CapMonster task created: ${taskId}`);

  // Poll until solved (max 120 seconds)
  for (let i = 0; i < 24; i++) {
    await sleep(5000);

    const resultRes = await axios.post(`${CAPMONSTER_URL}/getTaskResult`, {
      clientKey: apiKey,
      taskId,
    });

    const { status, solution, errorId, errorDescription } = resultRes.data;

    if (errorId && errorId !== 0) {
      throw new Error(`CapMonster error: ${errorDescription ?? errorId}`);
    }

    if (status === "ready" && solution?.token) {
      console.log("CapMonster solved the captcha.");
      return solution.token as string;
    }

    console.log(`CapMonster status: ${status} (attempt ${i + 1}/24)`);
  }

  throw new Error("CapMonster timed out solving the captcha.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
