-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "is_sample" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "notes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "notes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "people" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "notes_by_owner" ON "notes"("owner_id", "id");
