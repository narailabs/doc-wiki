import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("publishers")
export class Publisher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;
}
