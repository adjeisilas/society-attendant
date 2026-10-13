"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatIsoDate } from "@/lib/dates";
import type { AttendanceDailyRow } from "../queries";
import styles from "./attendance-chart.module.css";

const SERIES = [
  { key: "presentCount", label: "Present", colour: "#15803d" },
  { key: "lateCount", label: "Late", colour: "#d4880f" },
  { key: "halfDayCount", label: "Half day", colour: "#83938f" },
  { key: "absentCount", label: "Absent", colour: "#c2332b" },
] as const;

/** Attendance per day. The same numbers are in the table below, for screen readers. */
export function AttendanceChart({ data }: { data: AttendanceDailyRow[] }) {
  const chartData = data.map((row) => ({ ...row, label: formatIsoDate(row.workDate, "d MMM") }));

  return (
    <div className={styles.chart} role="img" aria-label="Attendance by day. The table below lists the same figures.">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#dde6e3" strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#c5d1cd" }} tick={{ fontSize: 12, fill: "#4f5f5c" }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#4f5f5c" }} />
          <Tooltip
            cursor={{ fill: "#eef3f1" }}
            contentStyle={{ border: "1px solid #dde6e3", borderRadius: 10, boxShadow: "0 14px 34px rgb(11 36 39 / 13%)" }}
            labelStyle={{ fontWeight: 800, color: "#0f1f1e" }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {SERIES.map((series, index) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              stackId="attendance"
              fill={series.colour}
              radius={index === SERIES.length - 1 ? [6, 6, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
