import { LineChart, Line, Customized, XAxis, YAxis } from "recharts";

const MyCustom = (props: any) => {
  console.log("Customized props:", Object.keys(props));
  return <circle cx={100} cy={100} r={50} fill="red" />;
};

export default function Test() {
  return (
    <LineChart width={400} height={400} data={[{name: 'A', uv: 400}, {name: 'B', uv: 300}]}>
      <XAxis dataKey="name" />
      <YAxis />
      <Line dataKey="uv" />
      <Customized component={MyCustom} />
    </LineChart>
  )
}
