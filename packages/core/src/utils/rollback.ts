import { ui } from "./ui.js";

export interface RollbackAction<Ctx> {
  label: string;
  fn: (ctx: Ctx) => Promise<void>;
  confirm?: boolean;
}

export interface RollbackExecuteOptions {
  interactive: boolean;
  sigint?: boolean;
}

export interface RollbackResult {
  succeeded: number;
  failed: number;
  skipped: number;
  manualRecovery: string[];
}

export class RollbackTracker<Ctx> {
  private actions: RollbackAction<Ctx>[] = [];
  private executed = false;
  private aborted = false;

  add(action: RollbackAction<Ctx>): void {
    this.actions.push(action);
  }

  get size(): number {
    return this.actions.length;
  }

  async execute(
    ctx: Ctx,
    options: RollbackExecuteOptions,
  ): Promise<RollbackResult> {
    const result: RollbackResult = {
      succeeded: 0,
      failed: 0,
      skipped: 0,
      manualRecovery: [],
    };

    if (this.executed) return result;
    this.executed = true;

    if (this.actions.length === 0) return result;

    // Listen for SIGINT during rollback
    const onSigint = () => {
      this.aborted = true;
    };
    process.on("SIGINT", onSigint);

    console.log(
      `\n${ui.chalk.yellow("⟲")} ${ui.chalk.yellow("Rolling back...")}`,
    );

    const reversed = [...this.actions].reverse();

    for (const action of reversed) {
      if (this.aborted) {
        result.skipped++;
        result.manualRecovery.push(action.label);
        continue;
      }

      // Skip confirm actions on SIGINT-triggered rollback (no prompt possible)
      if (action.confirm && options.sigint) {
        console.log(
          `  ${ui.chalk.dim("⊘")} Skipped: ${action.label} (requires confirmation)`,
        );
        result.skipped++;
        result.manualRecovery.push(action.label);
        continue;
      }

      try {
        console.log(`  ${ui.chalk.yellow("↩")} ${action.label}`);
        await action.fn(ctx);
        console.log(`  ${ui.chalk.green("✓")} ${action.label}`);
        result.succeeded++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  ${ui.chalk.red("✖")} ${action.label} — ${msg}`);
        result.failed++;
        result.manualRecovery.push(action.label);
      }
    }

    process.removeListener("SIGINT", onSigint);

    // Summary
    const total = result.succeeded + result.failed + result.skipped;
    if (result.failed > 0 || result.skipped > 0) {
      const parts = [`${result.succeeded}/${total}`];
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      console.log(
        `${ui.chalk.red("✖")} ${ui.chalk.red("Rollback completed with errors")} (${parts.join(", ")})`,
      );
      if (result.manualRecovery.length > 0) {
        console.log("  Manual recovery needed:");
        for (const item of result.manualRecovery) {
          console.log(`    • ${item}`);
        }
      }
    } else {
      console.log(
        `${ui.chalk.green("✓")} Rollback completed (${result.succeeded}/${total})`,
      );
    }

    return result;
  }

  reset(): void {
    this.actions = [];
    this.executed = false;
    this.aborted = false;
  }
}
