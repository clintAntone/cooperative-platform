declare module 'recharts'
declare module 'jspdf' {
  class jsPDF {
    setFillColor(r: number, g: number, b: number): this
    rect(x: number, y: number, w: number, h: number, style?: string): this
    setTextColor(r: number, g: number, b: number): this
    setFontSize(size: number): this
    setFont(fontName: string, fontStyle?: string): this
    text(text: string, x: number, y: number, options?: { align?: string }): this
    save(filename: string): this
  }
  export default jsPDF
}
declare module 'jspdf-autotable'
