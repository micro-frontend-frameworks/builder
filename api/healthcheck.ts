import { VercelRequest, VercelResponse } from "@vercel/node";

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end("Method Not Allowed");

    return res;
  }

  res.setHeader("Content-Type", "application/json");
  res.status(200).json("OK");

  return res;
};
