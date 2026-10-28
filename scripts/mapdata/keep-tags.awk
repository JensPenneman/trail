# Keeps, of each OPL line that `osmium cat` writes for a way, the tags Trail
# reads (keptTags in apps/api/src/processing/parseOverpassResponse.ts), and
# counts the ways and their node references. OPL writes a space, ",", "=",
# "@" and "%" inside a key or value as %<hex>%, so a line splits on spaces
# into fields and a T field on commas into tags.
#
#   awk -v stats=FILE -f keep-tags.awk ways.opl > kept.opl
#
# FILE gets one line: the number of ways, tab, the number of node references.
BEGIN {
  n = split("highway railway service maxspeed name route public_transport oneway", names, " ")
  for (i = 1; i <= n; i++) keep[names[i]] = 1
  refs = 0
}
{
  line = ""
  for (f = 1; f <= NF; f++) {
    field = $f
    first = substr(field, 1, 1)
    if (first == "T") {
      count = split(substr(field, 2), tags, ",")
      field = "T"
      sep = ""
      for (t = 1; t <= count; t++) {
        eq = index(tags[t], "=")
        key = eq > 0 ? substr(tags[t], 1, eq - 1) : tags[t]
        if (key in keep) {
          field = field sep tags[t]
          sep = ","
        }
      }
    } else if (first == "N" && length(field) > 1) {
      refs += gsub(/,/, ",", field) + 1
    }
    line = line (f > 1 ? " " : "") field
  }
  print line
}
END {
  if (stats != "") printf "%d\t%d\n", NR, refs > stats
}
