import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { User } from "./User";

@Entity("orders")
export class Order {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "decimal", precision: 10, scale: 2 })
    totalAmount: number;

    @ManyToOne(() => User, (user) => user.orders)
    @JoinColumn({ name: "user_id" })
    user: User;
}
