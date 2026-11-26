# Plasma Toroid Lab

**ผู้จัดทำ Watcharachai Leatsuriyakarn**

เปเปอร์แบบโต้ตอบได้ที่จำลองบอร์ด sky guided plasma toroid v2.3.0 ตั้งแต่วงจรขับ สนามแม่เหล็กไฟฟ้า แรงบนผิวโดนัท ไปจนถึงวงแหวนพลาสมาซีนอนและสมดุลพลังงาน สลับภาษาไทยและอังกฤษได้ในหน้าเว็บ

An interactive paper by **Watcharachai Leatsuriyakarn** that simulates the sky guided plasma toroid v2.3.0 board, from the drive circuit and its electromagnetic field, through the forces on the donut surface, to the xenon plasma ring and its energy balance. Thai and English are switchable on the page.

เว็บไซต์ / Live site: https://wa-shi.github.io/Plasma-toroid-experiment-theorem/

## เนื้อหาในเปเปอร์ / What the paper covers

1. แผนวงจรจริงของบอร์ดจากไฟล์ KiCad พร้อมจุดแสดงกระแสที่ไหลจริงในแต่ละสาย ปรับ RV1, RV2 และกด SW2 ได้
2. สมการสถานะของวงจรและการแก้เชิงตัวเลขแบบ implicit trapezoid
3. สนามแม่เหล็กไฟฟ้ารอบคอยล์แบบสามมิติและภาพตัดขวาง
4. คอยล์กับพลาสมาในฐานะหม้อแปลง สภาพนำไฟฟ้า และ skin depth
5. แรงลอเรนซ์บนพลาสมาและค่า β เทียบกับโทคาแมค
6. ผิวโดนัท ระบบพิกัด และแคลคูลัสบนผิว พร้อมฟลักซ์แสงผ่านผิวแก้ว
7. กฎอนุรักษ์พลังงานและแบบจำลองพลาสมาศูนย์มิติ
8. สมดุลพลังงานจากปลั๊กถึงแสง และการทดลองสี่ชุดที่จะวัดค่าเหล่านี้

## ไฟล์ / Files

| File | Purpose |
|---|---|
| `index.html` | The paper, layout and equations (MathJax) |
| `app.js` | Figures, live circuit animation, 3D views (three.js), language switch |
| `physics.js` | Circuit solver, coil fields, 0D xenon plasma model, torus surface calculus |
| `worker.js` | Runs the operating point off the main thread |
| `schem.js` | KiCad sheet viewer with live current flow |
| `sheet.js`, `sheet_dark.js` | The board schematic, compacted from the original KiCad export |
| `fonts.css` | Latin Modern and IBM Plex Sans Thai, embedded |

ทุกไฟล์เป็น static เปิด `index.html` ในเครื่องได้เลย หรือวางบนโฮสต์แบบ static ใดก็ได้
Everything is static. Open `index.html` locally or serve the folder from any static host.

## สัญญาอนุญาตและเครดิต / Licence and credits

ใช้สัญญาอนุญาตเดียวกับโปรเจกต์ต้นฉบับ คือ **CC BY-SA 4.0** (Creative Commons Attribution-ShareAlike) นำไปใช้และดัดแปลงได้ รวมถึงเชิงพาณิชย์ โดยต้องให้เครดิตทั้งสองฝ่ายด้านล่าง และเผยแพร่งานดัดแปลงด้วยสัญญาอนุญาตเดียวกัน รายละเอียดอยู่ในไฟล์ [LICENSE](LICENSE)

This repository uses the same licence as the original project, **CC BY-SA 4.0**. You may share and adapt it, commercially too, as long as you credit both parties below and release your changes under the same licence. See [LICENSE](LICENSE).

| ส่วน / Part | ผู้สร้าง / Author |
|---|---|
| ฮาร์ดแวร์และแผนวงจรต้นฉบับ / Original hardware and schematic | sky guided, [sky-guided-plasma-toroid](https://codeberg.org/sky-guided/sky-guided-plasma-toroid) (CC-BY-SA) |
| การจำลอง เปเปอร์ รูป และโค้ด / Simulation, paper, figures and code | Watcharachai Leatsuriyakarn |

ต้นฉบับระบุสัญญาอนุญาตเป็น CC-BY-SA โดยไม่ได้ระบุเวอร์ชัน รีโพนี้จึงใช้เวอร์ชันล่าสุดคือ 4.0
The original states CC-BY-SA without a version number, so this repository uses the current version, 4.0.

ฟอนต์และไลบรารีภายนอกใช้สัญญาอนุญาตของตัวเอง ได้แก่ Latin Modern (GUST Font License), IBM Plex Sans Thai (SIL OFL 1.1), three.js (MIT) และ MathJax (Apache-2.0)

อ้างอิงทางฟิสิกส์อยู่ท้ายเปเปอร์ หลักๆ คือ A. Piel, *Plasma Physics*, 2nd ed., Springer, 2017
Physics references are listed at the end of the paper, chiefly A. Piel, *Plasma Physics*, 2nd ed., Springer, 2017.

Powered by Claude Opus 5.5
