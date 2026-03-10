import chalk from "chalk";

export class Progress {
  private current = 0;

  constructor(
    private total: number,
    private label: string = "",
  ) {}

  /** Update progress -- prints a single line that overwrites itself */
  tick(message?: string): void {
    this.current++;
    const pct = Math.round((this.current / this.total) * 100);
    const bar = this.renderBar(pct);
    const status = message ?? `${this.current}/${this.total}`;
    process.stdout.write(`\r${chalk.cyan(this.label)} ${bar} ${pct}% ${status}  `);
    if (this.current >= this.total) {
      process.stdout.write("\n");
    }
  }

  private renderBar(pct: number): string {
    const width = 20;
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    return chalk.green("\u2588".repeat(filled)) + chalk.gray("\u2591".repeat(empty));
  }
}
