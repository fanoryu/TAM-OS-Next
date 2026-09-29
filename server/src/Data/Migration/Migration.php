<?php
declare(strict_types=1);

namespace TamOs\Data\Migration;

/**
 * One validated migration file: its version, name, the SHA-256 of its exact bytes, and those
 * bytes. Built only by MigrationSet.
 */
final class Migration
{
    public function __construct(
        public readonly int $version,
        public readonly string $name,
        public readonly string $sha256,
        public readonly string $sql,
    ) {
    }

    /** `NNNN_name`, as in the file name. */
    public function label(): string
    {
        return sprintf('%04d_%s', $this->version, $this->name);
    }

    /**
     * The text sent to the server: trailing whitespace and at most one final `;` removed,
     * nothing else rewritten. The checksum always covers the original bytes.
     */
    public function sqlForExecution(): string
    {
        $text = rtrim($this->sql);
        return str_ends_with($text, ';') ? substr($text, 0, -1) : $text;
    }
}
