/**
 * Shared UI constants — conservation colors and map type colors.
 */

export function conservationColor(status) {
  if (!status) return "bg-gray-100 text-gray-700";
  const s = status.toLowerCase();
  if (s.includes("criticamente") || s.includes("critically"))
    return "bg-red-600 text-white";
  if (s.includes("perigo") || s.includes("endangered") || s.includes("em perigo"))
    return "bg-red-500 text-white";
  if (s.includes("vulnerável") || s.includes("vulnerable"))
    return "bg-orange-500 text-white";
  if (s.includes("quase") || s.includes("near"))
    return "bg-yellow-500 text-white";
  if (s.includes("pouco preocupante") || s.includes("least"))
    return "bg-green-600 text-white";
  if (s.includes("dados") || s.includes("deficient"))
    return "bg-gray-400 text-white";
  return "bg-blue-100 text-blue-800";
}

export const typeColors = {
  Fish: { color: "#3b82f6", bgColor: "#dbeafe" },
  Mammal: { color: "#06b6d4", bgColor: "#cffafe" },
  Coral: { color: "#ec4899", bgColor: "#fce7f3" },
  Invasive: { color: "#ef4444", bgColor: "#fee2e2" },
  Other: { color: "#f59e0b", bgColor: "#fef3c7" },
  "Observação": { color: "#10b981", bgColor: "#d1fae5" },
};
