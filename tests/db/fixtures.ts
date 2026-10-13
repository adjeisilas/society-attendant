import type { PGlite } from "@electric-sql/pglite";
import type { Queryable } from "./harness.ts";

/**
 * Two hospitals with enough people to exercise every role scope:
 * - Hospital A: admin (no staff record), Emergency head, Emergency nurse,
 *   Maternity midwife, and a Maternity porter without an account.
 * - Hospital B: admin and an Emergency nurse.
 */
export const ids = {
  hospitalA: "0a000000-0000-4000-8000-000000000001",
  hospitalB: "0b000000-0000-4000-8000-000000000001",
  departments: {
    emergencyA: "0a000000-0000-4000-8000-0000000000d1",
    maternityA: "0a000000-0000-4000-8000-0000000000d2",
    emergencyB: "0b000000-0000-4000-8000-0000000000d1",
  },
  staff: {
    headA: "0a000000-0000-4000-8000-000000000051",
    nurseA: "0a000000-0000-4000-8000-000000000052",
    midwifeA: "0a000000-0000-4000-8000-000000000053",
    porterA: "0a000000-0000-4000-8000-000000000054",
    nurseB: "0b000000-0000-4000-8000-000000000051",
  },
  users: {
    superAdmin: "00000000-0000-4000-8000-0000000000aa",
    adminA: "0a000000-0000-4000-8000-0000000000a1",
    headA: "0a000000-0000-4000-8000-0000000000a2",
    nurseA: "0a000000-0000-4000-8000-0000000000a3",
    midwifeA: "0a000000-0000-4000-8000-0000000000a4",
    adminB: "0b000000-0000-4000-8000-0000000000a1",
    nurseB: "0b000000-0000-4000-8000-0000000000a3",
  },
} as const;

export interface ProvisioningMetadata {
  role: string;
  hospital_id?: string;
  staff_id?: string;
  display_name?: string;
}

/** Inserts an auth user the way the Auth admin API does, firing the provisioning trigger. */
export async function insertAuthUser(
  db: Queryable,
  id: string,
  email: string,
  metadata: ProvisioningMetadata | Record<string, string>,
): Promise<void> {
  await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
    id,
    email,
    JSON.stringify(metadata),
  ]);
}

export async function seedTenants(db: PGlite): Promise<void> {
  const { hospitalA, hospitalB, departments: d, staff: s, users: u } = ids;

  await db.exec(`
    insert into public.hospitals (id, name, code, timezone) values
      ('${hospitalA}', 'Korle General Hospital', 'KGH', 'Africa/Accra'),
      ('${hospitalB}', 'Northern Regional Hospital', 'NRH', 'Africa/Accra');

    insert into public.departments (id, hospital_id, name, code) values
      ('${d.emergencyA}', '${hospitalA}', 'Emergency', 'ER'),
      ('${d.maternityA}', '${hospitalA}', 'Maternity', 'MAT'),
      ('${d.emergencyB}', '${hospitalB}', 'Emergency', 'ER');

    insert into public.staff
      (id, hospital_id, department_id, employee_number, first_name, last_name, email, job_title, employment_type, hire_date)
    values
      ('${s.headA}',    '${hospitalA}', '${d.emergencyA}', 'KGH-001', 'Kofi',   'Boateng', 'k.boateng@kgh.example.test', 'Head of Emergency', 'full_time', '2018-03-01'),
      ('${s.nurseA}',   '${hospitalA}', '${d.emergencyA}', 'KGH-002', 'Efua',   'Owusu',   'e.owusu@kgh.example.test',   'Staff Nurse',       'full_time', '2021-06-14'),
      ('${s.midwifeA}', '${hospitalA}', '${d.maternityA}', 'KGH-003', 'Akosua', 'Asante',  'a.asante@kgh.example.test',  'Midwife',           'full_time', '2019-09-02'),
      ('${s.porterA}',  '${hospitalA}', '${d.maternityA}', 'KGH-004', 'Yaw',    'Mensah',  'y.mensah@kgh.example.test',  'Porter',            'contract',  '2024-01-08'),
      ('${s.nurseB}',   '${hospitalB}', '${d.emergencyB}', 'NRH-001', 'Abena',  'Darko',   'a.darko@nrh.example.test',   'Staff Nurse',       'full_time', '2022-02-01');
  `);

  await insertAuthUser(db, u.superAdmin, "platform.admin@example.test", {
    role: "super_admin",
    display_name: "Platform Admin",
  });
  await insertAuthUser(db, u.adminA, "hr@kgh.example.test", {
    role: "hospital_admin",
    hospital_id: hospitalA,
    display_name: "KGH HR Office",
  });
  await insertAuthUser(db, u.headA, "k.boateng@kgh.example.test", {
    role: "staff",
    hospital_id: hospitalA,
    staff_id: s.headA,
  });
  await insertAuthUser(db, u.nurseA, "e.owusu@kgh.example.test", {
    role: "staff",
    hospital_id: hospitalA,
    staff_id: s.nurseA,
  });
  await insertAuthUser(db, u.midwifeA, "a.asante@kgh.example.test", {
    role: "staff",
    hospital_id: hospitalA,
    staff_id: s.midwifeA,
  });
  await insertAuthUser(db, u.adminB, "hr@nrh.example.test", {
    role: "hospital_admin",
    hospital_id: hospitalB,
    display_name: "NRH HR Office",
  });
  await insertAuthUser(db, u.nurseB, "a.darko@nrh.example.test", {
    role: "staff",
    hospital_id: hospitalB,
    staff_id: s.nurseB,
  });

  await db.query("update public.departments set head_staff_id = $1 where id = $2", [s.headA, d.emergencyA]);
}
