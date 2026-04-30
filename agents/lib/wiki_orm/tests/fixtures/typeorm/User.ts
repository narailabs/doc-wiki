import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { Order } from "./Order";

@Entity("users")
export class User {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 150, unique: true })
    username: string;

    @Column({ type: "varchar" })
    email: string;

    @OneToMany(() => Order, (order) => order.user)
    orders: Order[];
}
