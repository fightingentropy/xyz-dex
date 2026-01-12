import { internalMutation } from "./_generated/server";

export const removeDemoSeedVersion = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let updated = 0;

    for (const user of users) {
      if ("demoSeedVersion" in user) {
        await ctx.db.patch(user._id, { demoSeedVersion: undefined });
        updated += 1;
      }
    }

    return { updated };
  },
});
