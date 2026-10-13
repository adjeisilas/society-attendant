/**
 * Generates src/types/database.ts from supabase/migrations, in the shape produced by
 * `supabase gen types typescript`. It uses the same in-memory PostgreSQL as the
 * database tests, so no Docker or linked Supabase project is required.
 *
 *   node scripts/generate-database-types.ts          write the file
 *   node scripts/generate-database-types.ts --check  exit 1 if the file is out of date
 *
 * Views are emitted read-only with nullable columns, as the Supabase generator does.
 * Unsupported schema features (overloaded functions, OUT parameters, unknown column
 * types) fail loudly instead of producing incorrect types.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, rows } from "../tests/db/harness.ts";

const OUTPUT_PATH = path.resolve(import.meta.dirname, "../src/types/database.ts");

interface PgTypeRef {
  typeName: string;
  typeKind: string;
  isArray: boolean;
}

interface ColumnRow extends PgTypeRef {
  tableName: string;
  /** pg_class.relkind: r/p tables, v/m views. */
  relationKind: string;
  columnName: string;
  isNullable: boolean;
  hasDefault: boolean;
  isGenerated: boolean;
}

interface EnumRow {
  enumName: string;
  labels: string[];
}

interface RelationshipRow {
  tableName: string;
  foreignKeyName: string;
  columns: string[];
  referencedRelation: string;
  referencedColumns: string[];
  isOneToOne: boolean;
}

interface FunctionArg extends PgTypeRef {
  name: string | null;
  isOptional: boolean;
}

interface FunctionRow {
  functionName: string;
  returnTypeName: string;
  returnTypeKind: string;
  returnsSet: boolean;
  hasArgModes: boolean;
  args: FunctionArg[];
}

interface Schema {
  columns: ColumnRow[];
  enums: EnumRow[];
  relationships: RelationshipRow[];
  functions: FunctionRow[];
}

const STRING_TYPES = new Set([
  "bpchar", "bytea", "citext", "date", "inet", "interval", "name", "text",
  "time", "timestamp", "timestamptz", "timetz", "uuid", "varchar",
]);
const NUMBER_TYPES = new Set(["float4", "float8", "int2", "int4", "int8", "numeric", "oid"]);

async function loadSchema(db: PGlite): Promise<Schema> {
  const columns = await rows<ColumnRow>(
    db,
    `select c.relname::text as "tableName",
            c.relkind::text as "relationKind",
            a.attname::text as "columnName",
            coalesce(et.typname, t.typname)::text as "typeName",
            coalesce(et.typtype, t.typtype)::text as "typeKind",
            (et.oid is not null) as "isArray",
            not a.attnotnull as "isNullable",
            (a.atthasdef or a.attidentity <> '') as "hasDefault",
            (a.attgenerated <> '' or a.attidentity = 'a') as "isGenerated"
     from pg_catalog.pg_attribute a
     join pg_catalog.pg_class c on c.oid = a.attrelid
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     join pg_catalog.pg_type t on t.oid = a.atttypid
     left join pg_catalog.pg_type et on et.oid = t.typelem and t.typcategory = 'A'
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attname`,
  );

  const enums = await rows<EnumRow>(
    db,
    `select t.typname::text as "enumName",
            array_agg(e.enumlabel::text order by e.enumsortorder) as labels
     from pg_catalog.pg_type t
     join pg_catalog.pg_enum e on e.enumtypid = t.oid
     join pg_catalog.pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     group by t.typname
     order by t.typname`,
  );

  const relationships = await rows<RelationshipRow>(
    db,
    `select src.relname::text as "tableName",
            con.conname::text as "foreignKeyName",
            array(
              select a.attname::text from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_catalog.pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
              order by k.ord
            ) as columns,
            ref.relname::text as "referencedRelation",
            array(
              select a.attname::text from unnest(con.confkey) with ordinality k(attnum, ord)
              join pg_catalog.pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum
              order by k.ord
            ) as "referencedColumns",
            exists (
              select 1 from pg_catalog.pg_constraint u
              where u.conrelid = con.conrelid
                and u.contype in ('p', 'u')
                and (select array_agg(x order by x) from unnest(u.conkey) x)
                  = (select array_agg(x order by x) from unnest(con.conkey) x)
            ) as "isOneToOne"
     from pg_catalog.pg_constraint con
     join pg_catalog.pg_class src on src.oid = con.conrelid
     join pg_catalog.pg_namespace n on n.oid = src.relnamespace
     join pg_catalog.pg_class ref on ref.oid = con.confrelid
     join pg_catalog.pg_namespace refn on refn.oid = ref.relnamespace
     where con.contype = 'f' and n.nspname = 'public' and refn.nspname = 'public'
     order by src.relname, con.conname`,
  );

  const functions = await rows<FunctionRow>(
    db,
    `select p.proname::text as "functionName",
            rt.typname::text as "returnTypeName",
            rt.typtype::text as "returnTypeKind",
            p.proretset as "returnsSet",
            (p.proargmodes is not null) as "hasArgModes",
            coalesce(
              json_agg(
                json_build_object(
                  'name', p.proargnames[a.ord],
                  'typeName', coalesce(et.typname, t.typname)::text,
                  'typeKind', coalesce(et.typtype, t.typtype)::text,
                  'isArray', et.oid is not null,
                  'isOptional', a.ord > p.pronargs - p.pronargdefaults
                ) order by p.proargnames[a.ord]
              ) filter (where a.ord is not null),
              '[]'::json
            ) as args
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     join pg_catalog.pg_type rt on rt.oid = p.prorettype
     left join lateral unnest(p.proargtypes::oid[]) with ordinality as a(type_oid, ord) on true
     left join pg_catalog.pg_type t on t.oid = a.type_oid
     left join pg_catalog.pg_type et on et.oid = t.typelem and t.typcategory = 'A'
     where n.nspname = 'public' and p.prokind = 'f' and rt.typname <> 'trigger'
     group by p.oid, p.proname, rt.typname, rt.typtype, p.proretset, p.proargmodes
     order by p.proname`,
  );

  const names = functions.map((fn) => fn.functionName);
  const overloaded = names.filter((name, index) => names.indexOf(name) !== index);
  if (overloaded.length > 0) {
    throw new Error(`Overloaded functions are not supported: ${overloaded.join(", ")}`);
  }
  const withModes = functions.filter((fn) => fn.hasArgModes);
  if (withModes.length > 0) {
    throw new Error(`OUT/INOUT parameters are not supported: ${withModes.map((fn) => fn.functionName).join(", ")}`);
  }

  return { columns, enums, relationships, functions };
}

function tsType({ typeName, typeKind, isArray }: PgTypeRef): string {
  let base: string;
  if (typeKind === "e") base = `Database["public"]["Enums"][${quote(typeName)}]`;
  else if (typeName === "bool") base = "boolean";
  else if (NUMBER_TYPES.has(typeName)) base = "number";
  else if (STRING_TYPES.has(typeName)) base = "string";
  else if (typeName === "json" || typeName === "jsonb") base = "Json";
  else if (typeName === "void") base = "undefined";
  else throw new Error(`Unsupported PostgreSQL type "${typeName}". Extend scripts/generate-database-types.ts.`);
  return isArray ? `${base}[]` : base;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item)) ?? [];
    group.push(item);
    groups.set(key(item), group);
  }
  return groups;
}

function renderDatabaseTypes(schema: Schema): string {
  const lines: string[] = [];
  const out = (indent: number, text: string) => lines.push(`${"  ".repeat(indent)}${text}`);
  const neverRecord = (indent: number, key: string) => {
    out(indent, `${key}: {`);
    out(indent + 1, "[_ in never]: never;");
    out(indent, "};");
  };

  out(0, "// Generated by scripts/generate-database-types.ts from supabase/migrations.");
  out(0, "// Do not edit by hand. Run `npm run db:types` after changing a migration.");
  out(0, "");
  out(0, "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];");
  out(0, "");
  out(0, "export type Database = {");
  out(1, "public: {");

  out(2, "Tables: {");
  const relationshipsByTable = groupBy(schema.relationships, (relationship) => relationship.tableName);
  const isView = (column: ColumnRow) => column.relationKind === "v" || column.relationKind === "m";
  const tableColumns = schema.columns.filter((column) => !isView(column));
  const viewColumns = schema.columns.filter(isView);

  for (const [table, columns] of groupBy(tableColumns, (column) => column.tableName)) {
    out(3, `${table}: {`);

    out(4, "Row: {");
    for (const column of columns) {
      out(5, `${column.columnName}: ${tsType(column)}${column.isNullable ? " | null" : ""};`);
    }
    out(4, "};");

    out(4, "Insert: {");
    for (const column of columns) {
      const type = `${tsType(column)}${column.isNullable ? " | null" : ""}`;
      if (column.isGenerated) out(5, `${column.columnName}?: never;`);
      else if (column.isNullable || column.hasDefault) out(5, `${column.columnName}?: ${type};`);
      else out(5, `${column.columnName}: ${type};`);
    }
    out(4, "};");

    out(4, "Update: {");
    for (const column of columns) {
      const type = column.isGenerated ? "never" : `${tsType(column)}${column.isNullable ? " | null" : ""}`;
      out(5, `${column.columnName}?: ${type};`);
    }
    out(4, "};");

    const relationships = relationshipsByTable.get(table) ?? [];
    if (relationships.length === 0) {
      out(4, "Relationships: [];");
    } else {
      out(4, "Relationships: [");
      for (const relationship of relationships) {
        out(5, "{");
        out(6, `foreignKeyName: ${quote(relationship.foreignKeyName)};`);
        out(6, `columns: [${relationship.columns.map(quote).join(", ")}];`);
        out(6, `isOneToOne: ${relationship.isOneToOne};`);
        out(6, `referencedRelation: ${quote(relationship.referencedRelation)};`);
        out(6, `referencedColumns: [${relationship.referencedColumns.map(quote).join(", ")}];`);
        out(5, "},");
      }
      out(4, "];");
    }
    out(3, "};");
  }
  out(2, "};");

  if (viewColumns.length === 0) {
    neverRecord(2, "Views");
  } else {
    out(2, "Views: {");
    for (const [view, columns] of groupBy(viewColumns, (column) => column.tableName)) {
      out(3, `${view}: {`);
      out(4, "Row: {");
      for (const column of columns) {
        out(5, `${column.columnName}: ${tsType(column)}${column.isNullable ? " | null" : ""};`);
      }
      out(4, "};");
      out(4, "Relationships: [];");
      out(3, "};");
    }
    out(2, "};");
  }

  if (schema.functions.length === 0) {
    neverRecord(2, "Functions");
  } else {
    out(2, "Functions: {");
    for (const fn of schema.functions) {
      out(3, `${fn.functionName}: {`);
      if (fn.args.length === 0) {
        out(4, "Args: never;");
      } else {
        out(4, "Args: {");
        for (const arg of fn.args) {
          if (!arg.name) throw new Error(`Function ${fn.functionName} has an unnamed argument.`);
          out(5, `${arg.name}${arg.isOptional ? "?" : ""}: ${tsType(arg)};`);
        }
        out(4, "};");
      }
      const returnType = tsType({ typeName: fn.returnTypeName, typeKind: fn.returnTypeKind, isArray: false });
      out(4, `Returns: ${returnType}${fn.returnsSet ? "[]" : ""};`);
      out(3, "};");
    }
    out(2, "};");
  }

  out(2, "Enums: {");
  for (const { enumName, labels } of schema.enums) {
    out(3, `${enumName}: ${labels.map(quote).join(" | ")};`);
  }
  out(2, "};");

  neverRecord(2, "CompositeTypes");
  out(1, "};");
  out(0, "};");
  out(0, "");
  out(0, 'type PublicSchema = Database["public"];');
  out(0, "");
  out(0, 'export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];');
  out(0, 'export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];');
  out(0, 'export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];');
  out(0, 'export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];');
  out(0, "");
  out(0, "export const Constants = {");
  out(1, "public: {");
  out(2, "Enums: {");
  for (const { enumName, labels } of schema.enums) {
    out(3, `${enumName}: [${labels.map(quote).join(", ")}],`);
  }
  out(2, "},");
  out(1, "},");
  out(0, "} as const;");

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const db = await createTestDatabase();
  try {
    const source = renderDatabaseTypes(await loadSchema(db));
    const relativePath = path.relative(process.cwd(), OUTPUT_PATH);

    if (process.argv.includes("--check")) {
      const current = await readFile(OUTPUT_PATH, "utf8").catch(() => "");
      if (current.replaceAll("\r\n", "\n") !== source) {
        console.error(`${relativePath} is out of date. Run \`npm run db:types\`.`);
        process.exitCode = 1;
        return;
      }
      console.log(`${relativePath} is up to date.`);
      return;
    }

    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, source);
    console.log(`Wrote ${relativePath}`);
  } finally {
    await db.close();
  }
}

await main();
