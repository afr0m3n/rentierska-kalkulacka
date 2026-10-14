/** End month is exclusive. Annual bars need the entire calendar-year bin. */
export function chartAxisBounds(asOfMonth: number, endMonth: number) {
  return {
    capital: { min: asOfMonth / 12, max: endMonth / 12 },
    rent: { min: Math.floor(asOfMonth / 12), max: Math.ceil(endMonth / 12) },
  };
}
