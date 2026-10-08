import * as XLSX from "xlsx";

export type PassengerRow = {
  fullName: string;
  phone: string;
  email: string;
  seats: number;
  paymentStatus: string;
  notes: string;
};

export function downloadPassengerWorkbook(input: {
  tourTitle: string;
  departure: string;
  guideName: string;
  driverName: string;
  fileName: string;
  passengers: PassengerRow[];
}) {
  const total = input.passengers.reduce((sum, person) => sum + person.seats, 0);
  const rows: (string | number)[][] = [
    ["Տուր", input.tourTitle],
    ["Մեկնման օր և ժամ", input.departure],
    ["Զբոսավար", input.guideName],
    ["Վարորդ", input.driverName],
    ["Ամրագրված ուղևորներ", total],
    [],
    ["№", "Անուն Ազգանուն", "Հեռախոսահամար", "Էլ. փոստ", "Ամրագրված տեղեր", "Վճարման կարգավիճակ", "Հատուկ նշումներ"],
    ...input.passengers.map((person, index) => [
      index + 1,
      person.fullName,
      person.phone,
      person.email,
      person.seats,
      person.paymentStatus,
      person.notes,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 28 },
    { wch: 36 },
    { wch: 20 },
    { wch: 28 },
    { wch: 20 },
    { wch: 24 },
    { wch: 24 },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Ուղևորներ");
  XLSX.writeFile(book, input.fileName);
}
