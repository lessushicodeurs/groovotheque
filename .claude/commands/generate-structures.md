Generate a PDF from the Structures.md file at the given path.

The argument is: $ARGUMENTS

Steps:
1. Write the following CSS to /tmp/md-tables.css:

```css
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 7.5pt;
  table-layout: fixed;
  word-wrap: break-word;
}
th, td {
  border: 1px solid #ccc;
  padding: 3px 5px;
  overflow-wrap: break-word;
  word-break: break-word;
  hyphens: auto;
}
th {
  background: #f0f0f0;
  font-weight: bold;
}
body {
  font-size: 10pt;
}
```

2. Run the following command to generate the PDF (replace INPUT with the argument path):
```
npx md-to-pdf --stylesheet /tmp/md-tables.css --pdf-options '{"format": "A4"}' INPUT
```

The output PDF will be in the same directory as the input file, with the same name but a .pdf extension. Report the output path when done.
